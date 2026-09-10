import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const teyvatState = fs.readFileSync('models/teyvat/state.ts', 'utf8');
const savePackage = fs.readFileSync('services/savePackage.ts', 'utf8');
const delta = fs.readFileSync('utils/saveDeltaStorage.ts', 'utf8');
const compactor = fs.readFileSync('utils/saveRuntimeCompactor.ts', 'utf8');
const saveLoad = fs.readFileSync('hooks/useGame/saveLoadWorkflow.ts', 'utf8');
const chatModel = fs.readFileSync('models/chat.ts', 'utf8');
assert(teyvatState.includes('任务: QuestJournal'), '正式 Teyvat 根必须携带任务系统。');
assert(teyvatState.includes('任务: normalizeQuestJournal(raw.任务)'), '正式 Teyvat 根必须归一化任务系统。');
assert(savePackage.includes("files: ['manifest.json', 'save.json']"), '单存档包必须携带完整正式根。');
assert(savePackage.includes('const portable = sanitizeTeyvatSaveForExport'), '存档包必须先把完整正式根归一化为可携带副本。');
assert(delta.includes("'任务'"), 'delta storage must track quests field.');
assert(delta.includes('quests:'), 'delta storage counters must track quests.');
assert(compactor.includes('compact任务系统'), 'runtime compactor must compact quest system.');
assert(chatModel.includes('任务?: unknown'), 'turn snapshot must carry quest system.');
assert(saveLoad.includes('const payload = normalizeTeyvatGameState({'), '保存负载必须通过完整正式根归一化任务。');
assert(saveLoad.includes('dependencies.replaceGameState(nextGame)'), '读档必须随完整正式根一次提交任务。');
console.log('quest save regression ok');
