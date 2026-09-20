import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const expectedRepository = 'zhongshao12/TeyvatYishi';
const obsoleteRepository = 'LingYuYue1/KaiTuoYiShi';

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

describe('desktop release repository configuration', () => {
  it.each([
    'src-tauri/tauri.conf.json',
    'services/desktop/desktopReleaseInfo.ts',
    'scripts/desktop-release-rules.mjs',
  ])('uses the public repository in %s', (relativePath) => {
    const source = read(relativePath);

    expect(source).toContain(expectedRepository);
    expect(source).not.toContain(obsoleteRepository);
  });
});
