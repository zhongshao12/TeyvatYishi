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

assert(scopes.includes("module.scope?.includes('calibration')"), 'independent modules must remain calibration-scoped.');
for (const [target, file, exportName] of contracts) {
  const source = read(file);
  assert(scopes.includes(`${target}:`), `missing formal prompt target ${target}.`);
  assert(source.includes(exportName) && source.includes(`'${target}'`), `${file} must select its formal prompt target.`);
}
assert(read('services/irminsulArchive.ts').includes("'irminsulArchive', { category: 'format' }"), 'Irminsul archive must read format modules only.');
console.log('formal independent prompt scope regression ok');
