import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

const unlock = fs.readFileSync('services/codexRuntimeUnlock.ts', 'utf8');
const enrichment = fs.readFileSync('utils/npcArchiveEnrichment.ts', 'utf8');
const saveLoad = fs.readFileSync('hooks/useGame/saveLoadWorkflow.ts', 'utf8');
const send = readWorkflowSources();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(unlock.includes('applyStoryArchiveCodexRuntimeUnlock') && unlock.includes('ArchiveCodex'), 'story archive unlock must update formal Codex entries.');
assert(enrichment.includes('buildCodexArchiveBaseline') && enrichment.includes('appearanceAnchor') && enrichment.includes('speechStyle'), 'NPC enrichment must consume formal Codex character anchors.');
assert(saveLoad.includes('图鉴 !== undefined ? { 图鉴 } : {}'), 'save override must persist the formal Codex slice.');
assert(send.includes('state.set图鉴(codexAfterRuntimeUnlock)') && send.includes('retrieveCodexEntries'), 'main workflow must commit and retrieve through formal Codex contracts.');
console.log('codex character rebuild regression ok');
