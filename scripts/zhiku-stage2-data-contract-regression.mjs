import fs from 'node:fs';
const model = fs.readFileSync('models/teyvat/codex.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
for (const field of ['category: string', 'runtimeUnlock:', 'usage:', 'relatedEntryIds: string[]', 'importance: number', 'builtin: boolean']) assert(model.includes(field), `Codex contract missing ${field}.`);
assert(model.includes('normalizeArchiveCodex') && model.includes('createEmptyArchiveCodex'), 'Codex must expose normalizer and formal empty factory.');
console.log('codex stage2 contract regression ok');
