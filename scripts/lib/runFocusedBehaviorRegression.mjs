import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Keep safety gates attached to executable production behavior, not a spelling. */
export function runFocusedBehaviorRegression(files, testNamePattern) {
  const args = [path.resolve('node_modules/vitest/vitest.mjs'), 'run', ...files];
  if (testNamePattern) args.push('--testNamePattern', testNamePattern);
  execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: 'inherit', env: process.env });
}
