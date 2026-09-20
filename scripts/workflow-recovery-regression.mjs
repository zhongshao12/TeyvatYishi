import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { readWorkflowSources, sliceWorkflowFile } from './lib/workflowSources.mjs';

const root = process.cwd();
const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-recovery-'));
const outfile = path.join(outDir, 'recovery.bundle.mjs');
async function resolveWorkspaceImport(specifier) {
  const base = path.join(root, specifier.slice(2));
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* try next */ }
  }
  return base;
}
await esbuild.build({
  stdin: {
    contents: `export * from '${path.join(root, 'utils/workflowRecoveryModel.ts').replaceAll('\\', '/')}'; export * from '${path.join(root, 'hooks/useGame/recoveryResume.ts').replaceAll('\\', '/')}';`,
    resolveDir: root,
    sourcefile: 'workflow-recovery-entry.ts',
    loader: 'ts',
  },
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
  plugins: [{
    name: 'workspace-alias',
    setup(build) {
      build.onResolve({ filter: /^@\// }, async (args) => ({ path: await resolveWorkspaceImport(args.path) }));
    },
  }],
});
const {
  createWorkflowRecoveryJournal,
  isWorkflowRecoveryComplete,
  parseWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  resolveRecoveryTarget,
} = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

const created = createWorkflowRecoveryJournal('继续前往观景车厢', 7);
assert.equal(created.version, 3);
assert.equal(created.phase, 'narrative_received');
assert.equal(created.turnAtStart, 7);
assert.equal(created.input, '继续前往观景车厢');

const pending = updateWorkflowRecoveryJournal(created, {
  phase: 'settlement_pending', userMessageId: 'user-7', assistantMessageId: 'assistant-7',
});
assert.equal(pending.phase, 'settlement_pending');
assert.deepEqual(resolveRecoveryTarget(pending), { kind: 'pending_settlement' });
const committed = updateWorkflowRecoveryJournal(pending, { phase: 'settlement_committed' });
assert.deepEqual(resolveRecoveryTarget(committed), { kind: 'post_settlement' });
assert.notDeepEqual(resolveRecoveryTarget(committed), { kind: 'pending_settlement' });
const complete = updateWorkflowRecoveryJournal(committed, { phase: 'autosave_committed' });
assert.equal(resolveRecoveryTarget(complete), null);
assert.equal(isWorkflowRecoveryComplete(complete, []), true);

for (const [historical, formal] of Object.entries({
  main_request: 'narrative_received', variable_settlement: 'settlement_pending',
  steambird: 'settlement_committed', memory: 'settlement_committed', courier_seed: 'settlement_committed',
  phone_seed: 'settlement_committed', news: 'settlement_committed', story_weaving: 'settlement_committed',
  image_parse: 'settlement_committed', image_generate: 'settlement_committed', autosave: 'settlement_committed',
})) {
  const parsedHistorical = parseWorkflowRecoveryJournal({ ...created, version: 2, phase: historical });
  assert.equal(parsedHistorical?.version, 3);
  assert.equal(parsedHistorical?.phase, formal, `${historical} must map only on old journal read`);
}
assert.equal(parseWorkflowRecoveryJournal({ ...created, version: 3, phase: 'variable_settlement' }), null, 'v3 journals must reject historical phase writes');
const parsed = parseWorkflowRecoveryJournal({ ...pending, apiKey: 'must-not-survive', systemPrompt: 'must-not-survive', streamedText: 'must-not-survive' });
assert(parsed);
assert.equal('apiKey' in parsed, false);
assert.equal('systemPrompt' in parsed, false);
assert.equal('streamedText' in parsed, false);

const inputArea = await fs.readFile(path.join(root, 'components/features/Chat/InputArea.tsx'), 'utf8');
// 迁移: 主剧情工作流已拆分为多阶段模块，改按登记表整体读取（只换读取源，断言语义不变）。
const sendWorkflow = readWorkflowSources();
assert(inputArea.includes('setInput(recoveryDraft.input)'), 'interrupted input must be restored into the editor');
const recoveryEffect = inputArea.slice(inputArea.indexOf('useEffect(() => {'), inputArea.indexOf('const handleSend'));
assert(!recoveryEffect.includes('onSend('), 'recovery must never automatically resend or charge the API');
assert(sendWorkflow.includes("phase: 'settlement_pending'"), 'main response must advance to settlement_pending');
assert(sendWorkflow.includes("phase: 'settlement_committed'"), 'successful root replace must advance to settlement_committed');
assert(sendWorkflow.includes("phase: 'autosave_committed'"), 'autosave completion must be journaled');
assert(sendWorkflow.includes('clearWorkflowRecoveryJournal(recoveryJournal.workflowId)'), 'successful and cancelled workflows must clear their own journal');
// 迁移: 旧切片 sendWorkflow.ts ['async function runPostSettlementWorkflow' .. 'export async function resumePostSettlementWorkflow')
//   -> 新切片 hooks/useGame/postSettlementRecoveryWorkflow.ts ['export async function runPostSettlementRecoveryWorkflow' .. 文件末尾)；
// 理由: settlement_committed 的恢复尾流程已拆成独立模块（sendWorkflow.ts 只保留 resumePostSettlementWorkflow 懒加载入口），
//   实现位置与函数名都变了，但意图不变——恢复必须执行幂等的任务归档，且绝不重放根命令事务。
//   ⚠️ 该切片改用 sliceWorkflowFile：原先「单文件读取 + indexOf 起点 + length 终点」虽然没跨文件，
//   但一旦改成拼接视图，切到「文件末尾」的写法就会吞掉后续登记文件（例如 variableSettlementWorkflow.ts
//   含 commitTeyvatTurn(、questWorkflow.ts 含 deriveQuestSettlementPlan(），把负断言变成假绿。
//   sliceWorkflowFile 把范围钉死在 postSettlementRecoveryWorkflow.ts 内，标记缺失即抛错。
const resumeBody = sliceWorkflowFile(
  'hooks/useGame/postSettlementRecoveryWorkflow.ts',
  'export async function runPostSettlementRecoveryWorkflow',
).text;
assert(resumeBody.includes('archiveCommittedQuestSettlement'), 'settlement_committed recovery must resume the idempotent quest archive');
assert(resumeBody.includes('deriveCommittedQuestArchiveFacts'), 'quest recovery archive must derive from committed quest state/facts');
assert(!resumeBody.includes('commitTeyvatTurn('), 'settlement_committed recovery must never replay the root command transaction');
assert(!resumeBody.includes('deriveQuestSettlementPlan('), 'settlement_committed recovery must never re-derive quest commands');

await fs.rm(outDir, { recursive: true, force: true });
console.log('workflow recovery regression ok');
