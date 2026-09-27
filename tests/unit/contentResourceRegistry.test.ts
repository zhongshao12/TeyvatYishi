import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildBuiltinContentRegistry, validateContentResources } from '@/data/contentResourceRegistry';

describe('bundled content registry', () => {
  it('rejects duplicate IDs, bad references, and invalid versions', () => {
    const issues = validateContentResources([
      { id: 'opening:x', kind: 'opening', version: 1, source: 'source', references: ['scenario:missing'] },
      { id: 'opening:x', kind: 'opening', version: 0, source: 'source' },
    ]);
    expect(issues.some((issue) => issue.includes('duplicate'))).toBe(true);
    expect(issues.some((issue) => issue.includes('reference'))).toBe(true);
    expect(issues.some((issue) => issue.includes('version'))).toBe(true);
  });

  it('all real built-in resources resolve and codex files exist', () => {
    const registry = buildBuiltinContentRegistry();
    const issues = validateContentResources(registry, (path) => existsSync(join(process.cwd(), 'public', path.replace(/^\//u, ''))));
    expect(issues).toEqual([]);
    expect(registry.filter((resource) => resource.kind === 'codex')).toHaveLength(6);
    expect(registry.some((resource) => resource.kind === 'worldbook-entry')).toBe(true);
  });
});
