import fs from 'node:fs';

const app = fs.readFileSync('App.tsx', 'utf8');
const modal = fs.readFileSync('components/features/Codex/CodexManagerModal.tsx', 'utf8');
const adapter = fs.readFileSync('components/features/Codex/productionAdapter.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(app.includes('CodexManagerModal') && app.includes('codex={state.图鉴}'), 'App must enter the formal Codex UI.');
assert(modal.includes('ArchiveCodex') && modal.includes('buildCodexArchiveItems'), 'Codex UI must consume formal archive items.');
assert(adapter.includes("from '@/services/codexRetrieval'"), 'Codex adapter must use formal retrieval previews.');
assert(!app.includes('ZhikuPanel') && !modal.includes('ZhikuPanel'), 'formal Codex UI must not restore the retired UI tree.');
console.log('codex negative UI guard regression ok');
