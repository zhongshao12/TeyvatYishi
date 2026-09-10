import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[background-task-mode] ${message}`);
    process.exit(1);
  }
}

const settings = read('models/settings.ts');
const gameSettings = read('components/features/Settings/GameSettings.tsx');
const sendWorkflow = read('hooks/useGame/sendWorkflow.ts');
const gameState = read('hooks/useGameState.ts');
const saveLoad = read('hooks/useGame/saveLoadWorkflow.ts');

assert(settings.includes("export type 后台任务模式 = 'sequential' | 'parallel'"), 'settings must define sequential/parallel background task mode.');
assert(settings.includes('backgroundTaskMode: 后台任务模式'), 'game settings must persist backgroundTaskMode.');
assert(settings.includes("backgroundTaskMode: 'sequential'"), 'background task mode must default to sequential.');

assert(gameSettings.includes('后台任务模式'), 'game settings UI must expose background task mode.');
assert(gameSettings.includes('稳序') && gameSettings.includes('并行'), 'background task mode UI must show sequential and parallel labels.');
assert(gameSettings.includes('主剧情前的世界树召回与图鉴召回始终会先完成'), 'UI must explain pre-main recalls still finish before main story.');

assert(gameState.includes('backgroundTaskMode: savedGame.backgroundTaskMode ?? defaults.backgroundTaskMode'), 'old local settings must normalize missing backgroundTaskMode.');
assert(saveLoad.includes('replaceGameState: state.replaceGameState'), 'formal save loading must replace only the Teyvat game root.');
assert(!saveLoad.includes('state.setGameSettings('), 'formal save loading must not overwrite local background-task preferences from save bytes.');

const irminsulRecall = sendWorkflow.indexOf('retrieveIrminsulEntries(');
const codexRecall = sendWorkflow.indexOf('retrieveCodexEntries(');
assert(irminsulRecall >= 0 && codexRecall >= 0, 'pre-main Irminsul and Codex recall must both be prepared before main story.');

assert(sendWorkflow.includes("state.gameSettings.backgroundTaskMode ?? 'sequential'"), 'send workflow must read backgroundTaskMode with sequential fallback.');
assert(sendWorkflow.includes('runSteambirdBackgroundJob()'), 'send workflow must isolate Steambird background job.');
assert(sendWorkflow.includes('runIrminsulArchiveJob()'), 'send workflow must isolate Irminsul archive job.');
assert(sendWorkflow.includes('runCourierFallbackJob()'), 'send workflow must isolate Courier fallback job.');
assert(sendWorkflow.includes('runNarrativeImageJob()'), 'send workflow must isolate narrative image job.');
assert(sendWorkflow.includes('await Promise.all([') && sendWorkflow.includes('runNarrativeImageJob(),'), 'parallel mode must launch independent background jobs together.');
assert(sendWorkflow.includes('chatHistory: finalHistoryForSave'), 'auto-save must use the final chat history after narrative images finish.');

console.log('[background-task-mode] ok');
