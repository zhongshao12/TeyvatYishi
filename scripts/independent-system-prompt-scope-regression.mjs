import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const scopes = read('services/promptModuleScopes.ts');
const contracts = [
  ['steambird', 'services/ai/steambirdModel.ts', 'buildSteambirdPromptModulesSection'],
  ['courier', 'services/ai/courierService.ts', 'buildCourierPromptModulesSection'],
  ['codex', 'services/codexRetrieval.ts', 'buildCodexPromptModulesSection'],
  ['irminsulRecall', 'services/irminsulRetrieval.ts', 'buildIrminsulRecallPromptModulesSection'],
  ['irminsulArchive', 'services/irminsulArchive.ts', 'buildIrminsulArchivePromptModulesSection'],
];

// R02（PROJECT_AUDIT_2026-10-03）：作用域机制已从「字符串里出现 calibration」演进为
// `services/promptDelivery.ts` 的 `explainPromptDelivery(module, target)`。契约不变
//（独立模块只能拿到自己的正式 target），断言随当前实现更新，而不是恢复旧写法。
assert(
  scopes.includes('explainPromptDelivery(module, target)'),
  'independent modules must select prompt modules through explainPromptDelivery.',
);
for (const [target, file, exportName] of contracts) {
  const source = read(file);
  // R02：每个独立系统必须显式声明自己的正式 target（旧写法是在 promptModuleScopes 里逐个登记
  // `steambird:` 之类的键，现已改为各服务自报 target + 统一的 explainPromptDelivery 过滤）。
  assert(source.includes(exportName) && source.includes(`'${target}'`), `${file} must select its formal prompt target.`);
}
assert(scopes.includes('filterIndependentPromptModules'), 'independent modules must share the generic target filter.');
assert(read('services/irminsulArchive.ts').includes("'irminsulArchive', { category: 'format' }"), 'Irminsul archive must read format modules only.');
console.log('formal independent prompt scope regression ok');
