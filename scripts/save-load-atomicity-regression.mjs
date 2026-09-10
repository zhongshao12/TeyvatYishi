import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const workflow = fs.readFileSync('hooks/useGame/saveLoadWorkflow.ts', 'utf8');
const fnStart = workflow.indexOf('async function executeTeyvatSaveLoadTransaction(');
assert(fnStart >= 0, 'executeTeyvatSaveLoadTransaction must exist.');
const fnEnd = workflow.indexOf('export async function applySaveToState', fnStart);
const fn = workflow.slice(fnStart, fnEnd);
const classifyIndex = fn.indexOf('dependencies.classify(rawSave)');
const normalizeIndex = fn.indexOf('normalizeTeyvatGameState(classified.state)');
const preCommitIndex = fn.indexOf('await dependencies.beforeReplace?.(nextGame)');
const replaceIndex = fn.indexOf('dependencies.replaceGameState(nextGame)');
const rejectionKinds = ['legacy-hsr', 'needs-input', 'invalid'];
assert(classifyIndex > 0, 'raw DB saves must be classified before any commit.');
assert(normalizeIndex > classifyIndex, 'a classified Teyvat save must be fully normalized before commit.');
assert(preCommitIndex > normalizeIndex && preCommitIndex < replaceIndex, 'all fallible pre-commit work must settle before replacement.');
assert(replaceIndex > normalizeIndex, 'replaceGameState must run only after classification and normalization.');
assert((fn.match(/dependencies\.replaceGameState\(/g) ?? []).length === 1, 'the success path must have exactly one root-state replacement.');
for (const kind of rejectionKinds) {
  const rejectionIndex = fn.indexOf(`classified.kind === '${kind}'`);
  assert(rejectionIndex > classifyIndex && rejectionIndex < normalizeIndex, `${kind} must reject before normalization and replacement.`);
  assert(fn.indexOf('throw new Error', rejectionIndex) < normalizeIndex, `${kind} must throw before replacement.`);
}
assert(!/\.set(?:旅人|世界|ChatHistory|记忆|忆庭|智库|手机|NPC|相册|新闻|剧情|剧情编织|VariableBatches|QueueTasks|任务|TurnCount)\(/.test(fn), 'load must not sequentially write any game-state slice.');
console.log('save load atomicity regression ok');
