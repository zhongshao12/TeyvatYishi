import fs from 'node:fs';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const budget = JSON.parse(fs.readFileSync('.index-safety-budget.json', 'utf8'));
const result = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '--noEmit', '--noUncheckedIndexedAccess'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);
const output = `${result.stdout || ''}\n${result.stderr || ''}`;
const diagnostics = output.split(/\r?\n/u).filter((line) => /error TS\d+:/u.test(line));
const maxErrors = Number(budget.maxErrors);

if (!Number.isInteger(maxErrors) || maxErrors < 0) {
  throw new Error('.index-safety-budget.json 的 maxErrors 必须是非负整数。');
}
if (diagnostics.length > maxErrors) {
  console.error(`noUncheckedIndexedAccess 错误由 ${maxErrors} 增至 ${diagnostics.length}，不得回退。`);
  console.error(diagnostics.slice(0, 40).join('\n'));
  process.exit(1);
}

console.log(`noUncheckedIndexedAccess debt: ${diagnostics.length}/${maxErrors}（只允许下降）`);
