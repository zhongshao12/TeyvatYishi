import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

const retrieval = fs.readFileSync('services/codexRetrieval.ts', 'utf8');
const send = readWorkflowSources();
const courier = fs.readFileSync('services/ai/courierService.ts', 'utf8');
const steambird = fs.readFileSync('services/ai/steambirdModel.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(retrieval.includes('buildCodexEntryInjectionPreview') && retrieval.includes('entry.injection.publicText'), 'Codex injection must prefer explicit public injection text.');
assert(retrieval.includes('entries.map(buildCodexEntryInjectionPreview)'), 'Codex recall must compile only selected entry previews.');
assert(send.includes('retrieveCodexEntries(') && send.includes('state.图鉴'), 'main workflow must retrieve from the formal Codex slice.');
assert(courier.includes("from '@/models/teyvat/courier'"), 'Courier service must not import retired knowledge models.');
assert(steambird.includes('publicFacts') && !steambird.includes('fullState:'), 'Steambird must receive only a public-facts DTO.');
console.log('codex stage4 injection regression ok');
