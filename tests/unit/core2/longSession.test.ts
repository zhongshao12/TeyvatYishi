import { expect, it } from 'vitest';
import { longSessionGateFailures, runCoreLongSession } from './longSession';

it('runs a bounded long session with recovery, replay and index gates', async () => {
  const metrics = await runCoreLongSession({ turns: 60, images: 2, querySamples: 20 });
  expect(metrics.events).toBe(60 * 5 + 30 + 1);
  expect(metrics.phoneCommits).toBe(30);
  expect(metrics.momentCommits).toBe(1);
  expect(metrics.imageBytes).toBe(2 * 51_200);
  expect(metrics.checkpointSeq).toBe(50);
  expect(metrics.recoveryCommits).toBeLessThanOrEqual(49);
  expect(metrics.turnsPerSecond).toBeGreaterThan(0);
  expect(metrics.postingHits).toBeGreaterThanOrEqual(metrics.querySamples);
  expect(metrics.endHeapMB).toBeGreaterThan(0);
  expect(metrics.measurementScope).toBe('ledger-only');
  expect(metrics.firstSourceReadMs).toBeGreaterThanOrEqual(0);
  expect(metrics).not.toHaveProperty('coldSourceReadMs');
  expect(longSessionGateFailures(metrics)).toEqual([]);
}, 120_000);

it.each([
  { npcCount: 0 }, { npcCount: 120 }, { npcCount: 1.5 }, { eventsPerTurn: 0 },
  { phoneEveryTurns: 0 }, { momentEveryTurns: -1 }, { images: -1 }, { querySamples: 0 },
])('rejects an unsupported ledger workload before opening a corpus: %j', async options => {
  await expect(runCoreLongSession({ turns: 1, ...options })).rejects.toThrow('CORE2_LONG_SESSION_OPTIONS_INVALID');
});
