import fs from 'node:fs';
const retrieval = fs.readFileSync('services/codexRetrieval.ts', 'utf8');
if (!retrieval.includes('retrieveCodexEntries') || !retrieval.includes('query.trim()')) throw new Error('Codex retrieval mode must be query driven.');
if (retrieval.includes('智库系统') || retrieval.includes('retrieveZhiku')) throw new Error('Codex retrieval must not retain runtime aliases.');
console.log('codex retrieval mode regression ok');
