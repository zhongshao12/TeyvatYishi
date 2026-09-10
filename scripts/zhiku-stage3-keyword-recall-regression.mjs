import fs from 'node:fs';

const retrieval = fs.readFileSync('services/codexRetrieval.ts', 'utf8');
const model = fs.readFileSync('models/teyvat/codex.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(retrieval.includes('retrieveCodexEntries(codex: ArchiveCodex, query: string'), 'Codex keyword recall must accept the formal ArchiveCodex contract.');
assert(retrieval.includes('entry.triggerKeywords') && retrieval.includes('entry.keywords'), 'Codex recall must search explicit and trigger keywords.');
assert(retrieval.includes('codex.unlockedEntryIds.includes(entry.id)') && retrieval.includes("entry.runtimeUnlock.status === 'unlocked'"), 'Codex recall must enforce unlock state.');
assert(model.includes('triggerKeywords: string[]') && model.includes('unlockedEntryIds: string[]'), 'Codex data contract must retain keyword and unlock fields.');
console.log('codex stage3 keyword recall regression ok');
