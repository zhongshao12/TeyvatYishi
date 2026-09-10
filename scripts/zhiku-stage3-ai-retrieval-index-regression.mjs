import fs from 'node:fs';
const index = fs.readFileSync('services/codexAiRetrievalIndex.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(index.includes('buildCodexAiCandidateIndex(codex: ArchiveCodex'), 'AI index must accept formal Codex.');
assert(index.includes('entriesById: new Map') && index.includes('selectedIds'), 'AI selection must resolve only indexed ids.');
assert(index.includes('buildCodexEntryInjectionPreview'), 'AI selection must compile formal injection previews.');
console.log('codex AI retrieval index regression ok');
