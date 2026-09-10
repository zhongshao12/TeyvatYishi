import fs from 'node:fs';
const prompt = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const send = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(prompt.includes('buildCourierSection(courier)') && prompt.includes('localArchive?.compressedSummaries'), 'main prompt must consume compressed Courier continuity.');
assert(prompt.includes('pendingDeliverySeeds') || prompt.includes('pendingSeeds'), 'main prompt must expose pending Courier delivery context.');
assert(send.includes('processScheduledCourierSeeds') && send.includes('state.set手机'), 'main settlement must process and commit phone delivery state.');
console.log('courier main continuity regression ok');
