import { describe, expect, it } from 'vitest';
import { createDesktopRepository } from '@/core/persistence/desktopRepository';
import { makeCommit, makeSeed } from './fixtures';
describe('desktop receipt validation', () => {
  it('rejects malformed native receipts instead of treating arbitrary JSON as a committed world', async () => {
    const repo = createDesktopRepository({ async send() { return { status: 'committed', arbitrary: true }; } });
    await expect(repo.commit(makeCommit(makeSeed().head))).rejects.toThrow('CORE2_INVALID_NATIVE_RESPONSE');
  });
});
