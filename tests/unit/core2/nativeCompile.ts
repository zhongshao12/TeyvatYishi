import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const compile = promisify(execFile);

/** Test transport bootstrap; the real Rust executable, not storage, is compiled here. */
export async function runNativeCompileCommand(command: string, args: readonly string[]): Promise<string> {
  const { stdout } = await compile(command, [...args], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024, windowsHide: true,
  });
  return stdout;
}
