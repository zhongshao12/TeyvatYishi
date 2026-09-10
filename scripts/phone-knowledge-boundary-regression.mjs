import fs from 'node:fs';
const snapshot = fs.readFileSync('hooks/useGame/contextSnapshot.ts', 'utf8');
const prompt = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(snapshot.includes('archiveFacts') && snapshot.includes('pendingDeliverySeeds'), 'Courier diagnostic context must be built from local archives and delivery seeds.');
assert(!snapshot.includes('courier: state.game') && !snapshot.includes('fullState'), 'Courier boundary must not pass the full game state.');
assert(prompt.includes('不要代替玩家回复') && prompt.includes('不是真完整通讯原文') === false, 'main prompt must preserve correspondence agency without claiming full private context.');
console.log('courier knowledge boundary regression ok');
