import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as dbService from '../../services/dbService';

describe('cloud merge staging startup cleanup', () => {
  it('removes only expired staging records and preserves a current transfer', async () => {
    const staleCreatedAt = new Date('2026-01-01T00:00:00Z').getTime();
    const now = new Date('2026-01-03T00:00:00Z').getTime();
      await dbService.stageCloudMergeRecord('stale-transfer', 'asset-old', {
        kind: 'asset',
        createdAt: staleCreatedAt,
        record: {
          id: 'old',
          blob: new Blob(['old']),
          mimeType: 'text/plain',
          size: 3,
          updatedAt: staleCreatedAt,
        },
      });

      await dbService.stageCloudMergeRecord('active-transfer', 'asset-new', {
        kind: 'asset',
        createdAt: now,
        record: {
          id: 'new',
          blob: new Blob(['new']),
          mimeType: 'text/plain',
          size: 3,
          updatedAt: now,
        },
      });

      const cleanup = Reflect.get(dbService, 'cleanupStaleCloudMergeStaging');
      expect(typeof cleanup).toBe('function');
      const summary = await (cleanup as (now: number) => Promise<{ removedRecords: number; retainedRecords: number }>)(now);

      expect(summary).toEqual({ removedRecords: 1, retainedRecords: 1 });
      await expect(dbService.loadCloudMergeStagedRecord('stale-transfer', 'asset-old')).resolves.toBeNull();
      await expect(dbService.loadCloudMergeStagedRecord('active-transfer', 'asset-new')).resolves.toMatchObject({
        kind: 'asset',
        record: { id: 'new' },
      });
  });
});
