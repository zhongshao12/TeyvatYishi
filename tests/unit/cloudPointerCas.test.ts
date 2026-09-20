import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  assertCloudPointerRevision,
  GitHubCloudWriteConflictError,
} from '@/services/githubCloudSave';

describe('GitHub cloud pointer compare-and-swap', () => {
  it('accepts the same pointer revision, including an absent pointer', () => {
    expect(() => assertCloudPointerRevision(null, null)).not.toThrow();
    expect(() => assertCloudPointerRevision('blob-old', 'blob-old')).not.toThrow();
  });

  it('rejects a pointer changed by another device', () => {
    expect(() => assertCloudPointerRevision('blob-old', 'blob-new'))
      .toThrow(GitHubCloudWriteConflictError);
    try {
      assertCloudPointerRevision(null, 'blob-created');
    } catch (error) {
      expect(error).toMatchObject({ code: 'GITHUB_CLOUD_POINTER_CONFLICT' });
    }
  });

  it('checks the pointer at the exact branch head used to build each commit', () => {
    const source = readFileSync(new URL('../../services/githubCloudSave.ts', import.meta.url), 'utf8');
    expect(source).toContain('readCloudPointerRevision(config, options.signal, head)');
    expect(source.indexOf('const head = await getBranchHead(config, options)'))
      .toBeLessThan(source.indexOf('readCloudPointerRevision(config, options.signal, head)'));
  });
});
