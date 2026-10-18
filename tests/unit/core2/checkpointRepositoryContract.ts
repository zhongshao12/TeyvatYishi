import { describe, expect, it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { nextBatch } from './snapshotRepositoryContract';

export function assertCheckpointRepositoryContract(factory: () => Promise<CoreRepository>): void {
  describe('atomic internal recovery checkpoints', () => {
    it('creates a hidden baseline without creating a player save slot', async () => {
      const repo = await factory(); const seed = makeSeed(); await repo.initialize(seed);
      expect(typeof repo.readRecoveryCheckpoint).toBe('function');
      const snapshot = await repo.readRecoveryCheckpoint(seed.head.scope);
      expect(snapshot.coreSeq).toBe(0); expect(snapshot.state).toEqual(await repo.readState(seed.head.scope));
      expect(await repo.listSaveSlots(seed.head.scope.journeyId)).toEqual([]);
    });
    it('publishes checkpoints in the same core transaction at 50-commit boundaries', async () => {
      const repo = await factory(); const seed = makeSeed(); await repo.initialize(seed);
      expect(typeof repo.readRecoveryCheckpoint).toBe('function');
      for (let sequence = 1; sequence <= 200; sequence++) {
        const batch = sequence === 1 ? makeBatch(seed) : await nextBatch(repo,seed.head.scope);
        await prepareBatch(repo,batch); await repo.commit(batch);
        if ([49,50,149,150,199,200].includes(sequence)) {
          const snapshot = await repo.readRecoveryCheckpoint(seed.head.scope);
          expect(snapshot.coreSeq).toBe(Math.floor(sequence/50)*50);
          expect(sequence-snapshot.coreSeq).toBeLessThanOrEqual(49);
          if (sequence % 50 === 0) expect(snapshot.state).toEqual(await repo.readState(seed.head.scope));
        }
      }
    }, 60_000);
  });
}
