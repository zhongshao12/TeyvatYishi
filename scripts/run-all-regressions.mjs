// 正式聚合门禁：运行 scripts/ 下全部 *-regression.mjs，并补收显式清单入口。
import fs from 'node:fs';
import { formatRegressionFailure, runRegressionScript } from './lib/regressionRunner.mjs';
import { EXTRA_REGRESSION_SCRIPTS } from './lib/regressionManifest.mjs';

const scanned = fs.readdirSync('scripts').filter((f) => f.endsWith('-regression.mjs'));
// 显式清单：补收不符合命名规则但必须执行的测试入口。
const all = Array.from(new Set([...EXTRA_REGRESSION_SCRIPTS, ...scanned])).sort();
const results = [];
for (const name of all) {
  const started = Date.now();
  const r = runRegressionScript(process.execPath, `scripts/${name}`);
  const ok = r.status === 0;
  results.push({ name, ok });
  if (!ok) {
    console.log(`FAIL ${name}`);
    console.log(formatRegressionFailure(r));
  }
}
const failed = results.filter((x) => !x.ok);
console.log(`\n全量汇总: ${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { console.log('失败: ' + failed.map((x) => x.name).join(', ')); process.exit(1); }
