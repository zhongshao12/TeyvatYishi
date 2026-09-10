import fs from 'node:fs';
const model = fs.readFileSync('models/teyvat/codex.ts', 'utf8');
const retrieval = fs.readFileSync('services/codexRetrieval.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(model.includes('currentFormAndLimits?: string') && model.includes('portrayalBoundaries?: string'), 'Codex character injection must preserve form and portrayal boundaries.');
assert(retrieval.includes('entry.injection.publicText') || retrieval.includes('entry.injection.facts'), 'retrieval must compile character injection content.');
console.log('codex multiform character regression ok');
