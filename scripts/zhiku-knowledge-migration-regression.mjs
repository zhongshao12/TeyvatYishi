import fs from 'node:fs';
const state = fs.readFileSync('hooks/useGameState.ts', 'utf8');
const save = fs.readFileSync('hooks/useGame/saveLoadWorkflow.ts', 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(state.includes('readLegacyRuntimeSlices') && state.includes('rawSnapshot'), 'historical knowledge input must remain readable through the explicit compatibility boundary.');
assert(state.includes('图鉴: root.图鉴') || state.includes('codex: root.图鉴'), 'historical input must normalize into the formal Codex slice.');
assert(save.includes('图鉴 !== undefined ? { 图鉴 } : {}'), 'new saves must write the formal Codex slice.');
console.log('codex knowledge migration regression ok');
