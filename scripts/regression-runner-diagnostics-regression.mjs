import assert from 'node:assert/strict';
import { formatRegressionFailure } from './lib/regressionRunner.mjs';

const spawnError = new Error('spawn EPERM');
spawnError.code = 'EPERM';

const formatted = formatRegressionFailure({
  error: spawnError,
  status: null,
  signal: 'SIGTERM',
  stdout: 'first line\nlast stdout line\n',
  stderr: 'first error\nlast stderr line\n',
});

assert.match(formatted, /spawn error: EPERM: spawn EPERM/);
assert.match(formatted, /signal: SIGTERM/);
assert.match(formatted, /last stderr line/);
assert.match(formatted, /last stdout line/);

console.log('regression runner diagnostics regression ok');
