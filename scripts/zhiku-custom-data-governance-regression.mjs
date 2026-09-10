import fs from 'node:fs';

const model = fs.readFileSync('models/teyvat/codex.ts', 'utf8');
const variables = fs.readFileSync('utils/variableExecutor.ts', 'utf8');
const registry = fs.readFileSync('utils/variableRegistry.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(model.includes('builtin: boolean') && model.includes('source: string'), 'Codex entries must retain builtin/custom provenance.');
assert(model.includes('normalizeArchiveCodex') && model.includes('unlockedEntryIds'), 'Codex normalization must preserve formal unlock state.');
assert(variables.includes('set图鉴') && !variables.includes('set智库'), 'variable settlement must commit through the formal Codex setter only.');
assert(registry.includes("'图鉴'"), 'variable registry must expose the formal Codex root.');
console.log('codex custom data governance regression ok');
