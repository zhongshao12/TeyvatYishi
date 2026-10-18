import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

it('keeps the new runtime import graph free of the legacy writable game root', () => {
  expect(() => execFileSync(process.execPath, ['scripts/core2-runtime-boundary-regression.mjs'], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true })).not.toThrow();
});
it('rejects an aliased legacy writer and a reexported legacy root instead of merely scanning filenames', () => {
  for (const entry of ['tests/fixtures/core2/runtime-boundary/alias-writer.ts', 'tests/fixtures/core2/runtime-boundary/root-reexport.ts']) {
    let output = '';
    try { execFileSync(process.execPath, ['scripts/core2-runtime-boundary-regression.mjs', '--entry', entry], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true, stdio: 'pipe' }); }
    catch (error) { output = (error as { stdout: string }).stdout; }
    expect(output).toContain(entry.includes('alias-writer') ? 'legacy_writer_call' : 'forbidden_module');
  }
});
