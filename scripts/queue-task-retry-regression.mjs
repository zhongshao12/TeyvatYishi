import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const queueModel = fs.readFileSync('models/queueTask.ts', 'utf8');
// 正文生图工作流已抽到 hooks/useGame/narrativeImageWorkflow.ts；按「主剧情工作流」整体读取。
// 迁移: 读取源由手工数组收敛为 scripts/lib/workflowSources.mjs 登记的工作流视图
//       （sendWorkflow / narrativeImageWorkflow 均已登记），后续搬迁不必再改本脚本数组。
const sendWorkflow = readWorkflowSources();
const useGame = fs.readFileSync('hooks/useGame.ts', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
const drawer = fs.readFileSync('components/features/Variable/VariableDrawer.tsx', 'utf8');

assert(queueModel.includes('targetMessageId?: string'), 'queue task records must store targetMessageId for narrative image retry.');
assert(queueModel.includes('targetBatchId?: string'), 'queue task records must store targetBatchId for variable retry.');
assert(sendWorkflow.includes('export async function retryQueueTask'), 'send workflow must export a queue task retry entry.');
assert(sendWorkflow.includes("task.id === 'narrative_image_parse' || task.id === 'narrative_image_generate'"), 'retry entry must support narrative image parse/generate.');
assert(sendWorkflow.includes('await regenerateNarrativeImagesForMessage(state, getActiveConfig, targetMessageId)'), 'narrative image retry must reuse the existing per-message regeneration path.');
assert(sendWorkflow.includes('async function retrySteambirdQueueTask'), 'Steambird retry helper must exist.');
assert(sendWorkflow.includes('本次不受回合间隔限制'), 'manual Steambird retry must explicitly bypass interval gating.');
assert(sendWorkflow.includes('async function retryVariableQueueTask'), 'variable retry helper must exist.');
assert(sendWorkflow.includes('findRetryableVariableBatch'), 'variable retry must locate a safe retryable batch.');
assert(sendWorkflow.includes('batch.results.every((result) => !result.ok)'), 'variable retry must only rerun fully failed batches to avoid duplicate successful commands.');
assert(sendWorkflow.includes('targetMessageId: messageId'), 'narrative image queue records must carry message id.');
assert(useGame.includes('handleRetryQueueTask'), 'useGame must expose queue retry action.');
assert(app.includes('onRetryTask={actions.handleRetryQueueTask}'), 'App must pass queue retry action to drawer.');
assert(drawer.includes('onRetryTask?: (task: 队列任务记录, mode: '), 'VariableDrawer props must accept queue retry callback.');
assert(drawer.includes("id === 'variable' || id === 'steambird' || id === 'narrative_image_parse' || id === 'narrative_image_generate'"), 'drawer must only show retry controls for supported tasks.');
assert(drawer.includes('重试') && drawer.includes('重生成'), 'drawer must show retry and reroll buttons.');

console.log('queue task retry regression ok');
