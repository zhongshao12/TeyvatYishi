import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { runNativeCompileCommand } from './nativeCompile';

it('keeps the worker event loop responsive while a cold native compiler is running', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'core2-build-heartbeat-')), marker = join(directory, 'continue');
  // The compiler fixture can finish only after this worker processes its timer.
  // A synchronous compile blocks that timer and deterministically fails the child.
  const heartbeat = setTimeout(() => writeFileSync(marker, 'ready'), 0);
  try {
    const result = await runNativeCompileCommand(process.execPath, ['-e', `
      const fs=require('node:fs'), marker=process.argv[1];
      const check=setInterval(()=>{if(fs.existsSync(marker)){clearInterval(check);clearTimeout(deadline);process.stdout.write('compiler-ready');}},5);
      const deadline=setTimeout(()=>{clearInterval(check);process.stderr.write('worker heartbeat blocked');process.exitCode=3;},1200);
    `, marker]);
    expect(result).toBe('compiler-ready');
  } finally {
    clearTimeout(heartbeat);
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'core2-build-heartbeat-')) throw Error('unsafe compile fixture cleanup');
    rmSync(directory, { recursive: true, force: true });
  }
});

it('propagates native build failures instead of treating stderr or a nonzero exit as an artifact', async () => {
  await expect(runNativeCompileCommand(process.execPath, ['-e', "process.stderr.write('fixture compile failed');process.exitCode=7;"]))
    .rejects.toThrow('fixture compile failed');
});
