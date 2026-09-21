import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    console.error(`[background-task-mode] ${message}`);
    process.exit(1);
  }
}

// 迁移: 读取源由单个 sendWorkflow.ts 收敛为 scripts/lib/workflowSources.mjs 登记的工作流视图。
// 理由: executeSendWorkflow 已按 M6 拆分为阶段模块——召回装配进了 mainRecallStage.ts，
//       后台任务编排进了 postTurnBackgroundTasks.ts，行为未变但字面量搬了家。
//       原先本脚本手工维护「编排器 + 阶段模块」数组，代码再搬一次就又红；
//       改用统一登记表（WORKFLOW_FILES 已含 sendWorkflow / mainRecallStage / postTurnBackgroundTasks），
//       行为断言范围不再被文件搬迁悄悄缩小，也不必逐脚本改数组。
// 仍显式读取的非视图文件：hooks/useGameState.ts（状态容器）、hooks/useGame/saveLoadWorkflow.ts（存档工作流），
//       二者在 workflowSources.mjs 的 WORKFLOW_OUT_OF_SCOPE 中「有意排除」，故保留显式读取。
const settings = read('models/settings.ts');
const gameSettings = read('components/features/Settings/GameSettings.tsx');
const sendWorkflow = readWorkflowSources();
const gameState = read('hooks/useGameState.ts');
const saveLoad = read('hooks/useGame/saveLoadWorkflow.ts');

assert(settings.includes("export type 后台任务模式 = 'sequential' | 'parallel'"), 'settings must define sequential/parallel background task mode.');
assert(settings.includes('backgroundTaskMode: 后台任务模式'), 'game settings must persist backgroundTaskMode.');
assert(settings.includes("backgroundTaskMode: 'sequential'"), 'background task mode must default to sequential.');

assert(gameSettings.includes('后台任务模式'), 'game settings UI must expose background task mode.');
assert(gameSettings.includes('稳序') && gameSettings.includes('并行'), 'background task mode UI must show sequential and parallel labels.');
assert(gameSettings.includes('主剧情前的世界树召回与图鉴召回始终会先完成'), 'UI must explain pre-main recalls still finish before main story.');

assert(gameState.includes('backgroundTaskMode: savedGame.backgroundTaskMode ?? defaults.backgroundTaskMode'), 'old local settings must normalize missing backgroundTaskMode.');
// 迁移: 见 extra-features-regression.mjs 同一条（相册物化下沉到提交前，第二轮审计 A4）。
assert(/replaceGameState:\s*\(next\)\s*=>\s*state\.replaceGameState\(/.test(saveLoad), 'formal save loading must replace only the Teyvat game root.');
assert(!saveLoad.includes('state.setGameSettings('), 'formal save loading must not overwrite local background-task preferences from save bytes.');

const irminsulRecall = sendWorkflow.indexOf('retrieveIrminsulEntries(');
const codexRecall = sendWorkflow.indexOf('retrieveCodexEntries(');
assert(irminsulRecall >= 0 && codexRecall >= 0, 'pre-main Irminsul and Codex recall must both be prepared before main story.');

assert(sendWorkflow.includes("state.gameSettings.backgroundTaskMode ?? 'sequential'"), 'send workflow must read backgroundTaskMode with sequential fallback.');
// 迁移: 旧写法 `runSteambirdBackgroundJob()` 等「就地定义的 async 任务 + 直接调用」-> 新写法
//   「就地定义具名 async 任务，作为 runPostTurnBackgroundTasks({ steambird, irminsul, courierDelivery, narrativeImage }) 的具名作业传入」。
//   理由: 串行/并行编排搬进 hooks/useGame/postTurnBackgroundTasks.ts，作业隔离仍在 sendWorkflow 里逐条成立；
//   故断言作业仍被具名隔离并接入正式编排入口，而不是删掉隔离要求。
assert(sendWorkflow.includes('const runSteambirdBackgroundJob = async (): Promise<void> =>'), 'send workflow must isolate Steambird background job.');
assert(sendWorkflow.includes('const runIrminsulArchiveJob = async (): Promise<void> =>'), 'send workflow must isolate Irminsul archive job.');
assert(sendWorkflow.includes('const runCourierFallbackJob = async (): Promise<void> =>'), 'send workflow must isolate Courier fallback job.');
assert(sendWorkflow.includes('const runNarrativeImageJob = async (): Promise<void> =>'), 'send workflow must isolate narrative image job.');
assert(
  sendWorkflow.includes('steambird: runSteambirdBackgroundJob,') &&
    sendWorkflow.includes('irminsul: runIrminsulArchiveJob,') &&
    sendWorkflow.includes('courierDelivery: runCourierFallbackJob,') &&
    sendWorkflow.includes('narrativeImage: runNarrativeImageJob,'),
  'isolated background jobs must be handed to the shared post-turn background orchestrator.',
);
assert(
  sendWorkflow.includes('runPostTurnBackgroundTasks({') &&
    sendWorkflow.includes('mode: state.gameSettings.backgroundTaskMode ?? \'sequential\','),
  'send workflow must delegate background task ordering to the shared orchestrator with the configured mode.',
);
assert(sendWorkflow.includes('if (jobs.mode === \'parallel\')') && sendWorkflow.includes('await Promise.all(['), 'parallel mode must launch independent background jobs together.');
assert(
  sendWorkflow.includes('jobs.steambird(),') &&
    sendWorkflow.includes('jobs.irminsul(),') &&
    sendWorkflow.includes('runCourierPipeline(),') &&
    sendWorkflow.includes('jobs.narrativeImage(),'),
  'parallel mode must launch every independent background job in the same batch.',
);
assert(sendWorkflow.includes('chatHistory: finalHistoryForSave'), 'auto-save must use the final chat history after narrative images finish.');

console.log('[background-task-mode] ok');
