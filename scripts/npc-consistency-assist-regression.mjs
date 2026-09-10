import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const npcModel = fs.readFileSync('models/npc.ts', 'utf8');
const builder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const panel = fs.readFileSync('components/features/GameSystems/CompanionPanel.tsx', 'utf8');
assert(npcModel.includes('玩家纠正记录?: string[]'), 'NPC model must carry correction records.');
assert(npcModel.includes('normalizeNpcTextList((input as Record<string, unknown>).玩家纠正记录'), 'NPC normalization must handle corrections.');
assert(builder.includes('玩家纠正记录（必须遵守'), 'system prompt must inject corrections.');
assert(panel.includes('correctionDraft'), 'CompanionPanel must expose a correction input.');
assert(panel.includes('追加玩家纠正'), 'correction input must have a placeholder.');
console.log('npc consistency assist regression ok');
