import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';
const prompt = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const send = readWorkflowSources();
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(prompt.includes('buildCourierSection(courier)') && prompt.includes('localArchive?.compressedSummaries'), 'main prompt must consume compressed Courier continuity.');
assert(prompt.includes('pendingDeliverySeeds') || prompt.includes('pendingSeeds'), 'main prompt must expose pending Courier delivery context.');
assert(send.includes('processScheduledCourierSeeds') && send.includes('state.set手机'), 'main settlement must process and commit phone delivery state.');
console.log('courier main continuity regression ok');
