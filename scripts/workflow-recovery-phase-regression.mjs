import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const sendWorkflow = readWorkflowSources();
const recoveryModel = fs.readFileSync('utils/workflowRecoveryModel.ts', 'utf8');
const legacyReadOnly = fs.readFileSync('compat/legacy-hsr/readOnly.ts', 'utf8');
const recoveryResume = fs.readFileSync('hooks/useGame/recoveryResume.ts', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
const formalPhases = ['narrative_received', 'settlement_pending', 'settlement_committed', 'autosave_committed'];

for (const phase of formalPhases) {
  assert(recoveryModel.includes(`'${phase}'`), `recovery model must declare formal phase ${phase}.`);
  assert(sendWorkflow.includes(`phase: '${phase}'`), `sendWorkflow must write formal phase ${phase}.`);
}
for (const historical of ['main_request', 'variable_settlement', 'steambird', 'memory', 'courier_seed', 'story_weaving', 'image_parse', 'image_generate', 'autosave']) {
  assert(recoveryModel.includes(`${historical}:`), `historical phase ${historical} must have an explicit parse-only mapping.`);
  assert(!sendWorkflow.includes(`phase: '${historical}'`), `live send must never write historical phase ${historical}.`);
}
for (const historical of ['phone_seed', 'news']) {
  assert(legacyReadOnly.includes(`value === '${historical}'`), `legacy compat must parse historical phase ${historical}.`);
  assert(!recoveryModel.includes(`${historical}:`), `formal recovery model must not declare retired phase ${historical}.`);
  assert(!sendWorkflow.includes(`phase: '${historical}'`), `live send must never write historical phase ${historical}.`);
}
assert(recoveryModel.includes("raw.version === 3") && recoveryModel.includes('HISTORICAL_PHASE_MAP[raw.phase]'), 'historical phases must normalize only while parsing pre-v3 journals.');
assert(recoveryResume.includes("journal.phase === 'settlement_committed'") && recoveryResume.includes("kind: 'post_settlement'"), 'committed settlement must target post-settlement recovery.');
assert(!recoveryResume.includes("taskId: 'steambird'"), 'formal recovery targets must not encode an old per-task phase chain.');
assert(app.includes('resumeCommittedSettlementWorkflow(state, recoveryJournal)'), 'App recovery entry must resume from the durable committed root.');
assert(recoveryResume.includes("phase: 'autosave_committed'"), 'committed recovery must persist autosave_committed only after resumed tail success.');

// 迁移: 旧切片在 readWorkflowSources() 拼接文本里找 'async function runPostSettlementWorkflow' ..
//   'export async function resumePostSettlementWorkflow'；实现已整体搬到 hooks/useGame/postSettlementRecoveryWorkflow.ts
//   并改名为 runPostSettlementRecoveryWorkflow（sendWorkflow.ts 只保留懒加载入口 resumePostSettlementWorkflow）。
// 理由: 切片来源与起止标记更新到真实位置，意图不变——post-settlement 恢复实现必须存在（切片非空），
//   且只能消费持久化 committed 根、不得重放命令事务。
const postSettlementRecovery = fs.readFileSync('hooks/useGame/postSettlementRecoveryWorkflow.ts', 'utf8');
const resumeStart = postSettlementRecovery.indexOf('export async function runPostSettlementRecoveryWorkflow');
const resumeEnd = postSettlementRecovery.length;
const resumeBody = postSettlementRecovery.slice(resumeStart, resumeEnd);
assert(resumeStart >= 0 && resumeEnd > resumeStart, 'post-settlement recovery implementation must exist.');
assert(resumeBody.includes('runSteambirdGenerationStep') && resumeBody.includes('processScheduledCourierSeeds') && resumeBody.includes('buildIrminsulArchiveEntry'), 'recovery tail must continue Steambird, Courier, and Irminsul work.');
assert(resumeBody.includes('generateNarrativeImagesForMessage') && resumeBody.includes("buildSavePayload(state, 'auto'"), 'recovery tail must continue image work and autosave.');
assert(resumeBody.includes('journal.committedState') && resumeBody.includes('committed.对话.entries'), 'recovery tail must consume the durable committed root and its formal history.');
assert(!resumeBody.includes('state.chatHistory') && !resumeBody.includes('state.NPC'), 'recovery tail must not read stale React history or NPC domain state.');
assert(resumeBody.includes("buildSavePayload(state, 'auto', undefined, savedRoot)"), 'recovery autosave must use the actual merged committed root as its base game.');
assert(!resumeBody.includes('commitTeyvatTurn') && !resumeBody.includes('reduceTeyvatTurn') && !resumeBody.includes('factsToTeyvatDomainCommands'), 'settlement_committed recovery must never replay commands.');
assert(sendWorkflow.includes('clearWorkflowRecoveryJournal(recoveryJournal.workflowId)'), 'sendWorkflow must clear the journal only after the final phase.');
assert(recoveryModel.includes('WORKFLOW_RECOVERY_STALE_MS'), 'recovery model must export a stale threshold.');

console.log('workflow recovery phase regression ok');
