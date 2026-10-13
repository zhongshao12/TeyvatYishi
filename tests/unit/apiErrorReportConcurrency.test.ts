import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ERROR_REPORTS_KEY, appendApiErrorReport, clearApiErrorReports, loadApiErrorReports, type ApiErrorReport } from '@/services/ai/apiErrorReportService';

const database = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  loadSetting: vi.fn<(key: string) => Promise<unknown>>(),
  saveSetting: vi.fn<(key: string, value: unknown) => Promise<void>>(),
}));
vi.mock('@/services/dbService', () => ({ loadSetting: database.loadSetting, saveSetting: database.saveSetting }));
vi.mock('@/utils/failureCenterStore', () => ({ reportFailure: vi.fn() }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
const saved = () => database.store.get(API_ERROR_REPORTS_KEY) as ApiErrorReport[];
const legacy: ApiErrorReport = {
  id: 'legacy', source: 'legacy', createdAt: '2026-10-12T00:00:00Z',
  provider: '', model: '', apiKeyHint: '', baseUrl: 'https://example.invalid?key=dummy-secret', message: 'failed',
};

describe('error report operation ownership (B13)', () => {
  beforeEach(() => {
    database.store.clear();
    database.loadSetting.mockReset().mockImplementation(async key => structuredClone(database.store.get(key) ?? []));
    database.saveSetting.mockReset().mockImplementation(async (key, value) => { database.store.set(key, structuredClone(value)); });
  });
  afterEach(() => vi.restoreAllMocks());

  it('retains both concurrently appended reports', async () => {
    await Promise.all([
      appendApiErrorReport({ source: 'a', error: 'first' }),
      appendApiErrorReport({ source: 'b', error: 'second' }),
    ]);
    expect(saved().map(report => report.source).sort()).toEqual(['a', 'b']);
  });

  it('does not let delayed historical redaction erase a new report', async () => {
    database.store.set(API_ERROR_REPORTS_KEY, [legacy]);
    const readGate = deferred();
    let readStarted = false;
    database.loadSetting.mockImplementationOnce(async () => {
      const snapshot = structuredClone(saved());
      readStarted = true;
      await readGate.promise;
      return snapshot;
    });
    const loading = loadApiErrorReports();
    await vi.waitFor(() => expect(readStarted).toBe(true));
    const appending = appendApiErrorReport({ source: 'new', error: 'latest' });
    await new Promise(resolve => setTimeout(resolve, 0));
    readGate.resolve();
    const [returned] = await Promise.all([loading, appending]);
    expect(returned[0]?.baseUrl).not.toContain('dummy-secret');
    expect(saved().map(report => report.source)).toEqual(['new', 'legacy']);
    expect(JSON.stringify(saved())).not.toContain('dummy-secret');
  });

  it('orders a delayed append, clear, and new append by invocation', async () => {
    const readGate = deferred();
    let readStarted = false;
    database.loadSetting.mockImplementationOnce(async () => {
      readStarted = true;
      await readGate.promise;
      return [];
    });
    const first = appendApiErrorReport({ source: 'before-clear', error: 'old' });
    await vi.waitFor(() => expect(readStarted).toBe(true));
    const clearing = clearApiErrorReports();
    const last = appendApiErrorReport({ source: 'after-clear', error: 'new' });
    await new Promise(resolve => setTimeout(resolve, 0));
    readGate.resolve();
    await Promise.all([first, clearing, last]);
    expect(saved().map(report => report.source)).toEqual(['after-clear']);
  });

  it('continues after a failed write without rejecting the diagnostic caller', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    database.saveSetting.mockRejectedValueOnce(new Error('fixture disk unavailable'));
    await appendApiErrorReport({ source: 'failed', error: 'first' });
    await appendApiErrorReport({ source: 'retained', error: 'second' });
    expect(saved().map(report => report.source)).toEqual(['retained']);
    expect(warning).toHaveBeenCalled();
  });

  it('retains the existing newest-80 limit during a concurrent burst', async () => {
    await Promise.all(Array.from({ length: 85 }, (_, index) => appendApiErrorReport({ source: `report-${index}`, error: 'failed' })));
    expect(saved()).toHaveLength(80);
    expect(saved()[0]?.source).toBe('report-84');
    expect(saved()[79]?.source).toBe('report-5');
  });
});
