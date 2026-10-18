import { act } from 'react';
import { vi } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
/** Await actual component reads inside React's update boundary; no persistence mock. */
export function observeReactRepositoryReads(repo: CoreRepository) {
  const reads = [vi.spyOn(repo, 'queryJobs'), vi.spyOn(repo, 'querySources'), vi.spyOn(repo, 'queryEvents'), vi.spyOn(repo, 'readAsset'), vi.spyOn(repo, 'readHead'), vi.spyOn(repo, 'readState'), vi.spyOn(repo, 'readOperation')];
  return async () => {
    let stable = 0;
    for (let pass = 0; pass < 8; pass++) {
      const before = reads.reduce((count, read) => count + read.mock.results.length, 0);
      await act(async () => { await Promise.allSettled(reads.flatMap(read => read.mock.results.map(result => result.value))); });
      stable = reads.reduce((count, read) => count + read.mock.results.length, 0) === before ? stable + 1 : 0;
      if (stable === 2) return;
    }
  };
}
