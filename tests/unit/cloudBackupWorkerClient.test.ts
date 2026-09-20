import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudBackupWorkerClient } from '../../services/cloudBackupWorkerClient';

class FakeWorker {
  static last: FakeWorker | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();

  constructor() {
    FakeWorker.last = this;
  }
}

describe('CloudBackupWorkerClient fatal errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.last = null;
  });

  it('terminates and discards a crashed worker after rejecting pending work', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const client = new CloudBackupWorkerClient();
    const pending = client.hash(new Uint8Array([1, 2, 3]));
    const worker = FakeWorker.last!;

    worker.onerror?.({} as ErrorEvent);

    await expect(pending).rejects.toThrow('云备份 Worker 异常终止。');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(Reflect.get(client, 'worker')).toBeNull();
  });
});
