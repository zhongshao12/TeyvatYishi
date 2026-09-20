import fs from 'node:fs';
import {
  EXTRA_REGRESSION_SCRIPTS,
  INTENTIONAL_MANUAL_SCRIPTS,
  REGRESSION_SUPPORT_MODULES,
} from './lib/regressionManifest.mjs';
import {
  collectNodeScriptEntries,
  collectPackageScriptClosure,
  findUnclassifiedScripts,
} from './lib/regressionEntryAudit.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const allTopLevelScripts = fs.readdirSync('scripts').filter((file) => file.endsWith('.mjs'));
const scannedRegressions = allTopLevelScripts.filter((file) => file.endsWith('-regression.mjs'));
const packageClosure = collectPackageScriptClosure(pkg.scripts, ['test']);
const packageEntries = collectNodeScriptEntries(pkg.scripts, packageClosure);
const allRunnerReachable = packageEntries.has('run-all-regressions.mjs');

assert(allRunnerReachable, '`pnpm test` 必须可达 run-all-regressions.mjs。');

const automaticallyReached = new Set([
  ...packageEntries,
  ...(allRunnerReachable ? scannedRegressions : []),
  ...(allRunnerReachable ? EXTRA_REGRESSION_SCRIPTS : []),
]);
const explicitlyClassified = new Set([
  ...automaticallyReached,
  ...INTENTIONAL_MANUAL_SCRIPTS,
  ...REGRESSION_SUPPORT_MODULES,
]);
const missing = findUnclassifiedScripts(allTopLevelScripts, explicitlyClassified);

assert(missing.length === 0, `发现未接入测试、也未标记为人工工具/支持模块的脚本: ${missing.join(', ')}`);
assert(
  findUnclassifiedScripts([...allTopLevelScripts, 'orphan-example.mjs'], explicitlyClassified).includes('orphan-example.mjs'),
  '入口审计必须能够识别新增的孤儿脚本。',
);
for (const file of [...EXTRA_REGRESSION_SCRIPTS, ...INTENTIONAL_MANUAL_SCRIPTS, ...REGRESSION_SUPPORT_MODULES]) {
  assert(allTopLevelScripts.includes(file), `脚本清单引用了不存在的文件: ${file}`);
}

console.log(`test entry coverage regression ok: auto=${automaticallyReached.size}, manual=${INTENTIONAL_MANUAL_SCRIPTS.length}, support=${REGRESSION_SUPPORT_MODULES.length}`);
