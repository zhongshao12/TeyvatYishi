import fs from 'node:fs';
const adapter = fs.readFileSync('components/features/Codex/productionAdapter.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(adapter.includes('buildCodexArchiveItems(codex: ArchiveCodex)'), 'production adapter must accept formal Codex.');
assert(adapter.includes('buildCodexEntryInjectionPreview') && adapter.includes('unlocked:'), 'adapter must preserve injection preview and unlock state.');
console.log('codex production adapter regression ok');
