import fs from 'node:fs';
const model = fs.readFileSync('models/teyvat/codex.ts', 'utf8');
const adapter = fs.readFileSync('components/features/Codex/productionAdapter.ts', 'utf8');
if (!model.includes('sourceText: string') || !model.includes('relatedEntryIds: string[]')) throw new Error('Codex must retain source and relationship expansion fields.');
if (!adapter.includes('codex.entries.map')) throw new Error('Codex adapter must expose the complete formal entry backlog before UI filtering.');
console.log('codex backlog expansion regression ok');
