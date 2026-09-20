import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 共享别名 loader：回归脚本会直接 import 生产 .ts（含 `@/...` 别名导入），
// 裸 node 无法解析，这里统一注入 resolve 钩子，避免每个脚本各修一遍。
const aliasRegisterUrl = new URL('./tsAliasRegister.mjs', import.meta.url).href;

export function nodeScriptArgs(scriptPath) {
  return ['--import', aliasRegisterUrl, scriptPath];
}

function tailLines(value, limit = 12) {
  return String(value || '').trim().split('\n').filter(Boolean).slice(-limit).join('\n');
}

export function formatRegressionFailure(result) {
  const details = [];
  if (result.error) {
    const code = result.error.code ? `${result.error.code}: ` : '';
    details.push(`spawn error: ${code}${result.error.message}`);
  }
  if (result.status !== null && result.status !== undefined) details.push(`exit status: ${result.status}`);
  if (result.signal) details.push(`signal: ${result.signal}`);

  const stderr = tailLines(result.stderr);
  const stdout = tailLines(result.stdout);
  if (stderr) details.push(`stderr:\n${stderr}`);
  if (stdout) details.push(`stdout:\n${stdout}`);
  return details.join('\n');
}

export function runRegressionScript(nodePath, scriptPath, options = {}) {
  return spawnSync(nodePath, nodeScriptArgs(scriptPath), {
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: options.timeout ?? 600_000,
  });
}
