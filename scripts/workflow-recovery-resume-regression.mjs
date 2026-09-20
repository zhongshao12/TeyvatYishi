import fs from 'node:fs';
import { readWorkflowSources, assertSpanWithinSingleFile } from './lib/workflowSources.mjs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const resume = fs.readFileSync('hooks/useGame/recoveryResume.ts', 'utf8');
const banner = fs.readFileSync('components/layout/RecoveryBanner.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
// 迁移: 主剧情工作流已拆分为多阶段模块，改按登记表整体读取（只换读取源，断言语义不变）。
const send = readWorkflowSources();
const model = fs.readFileSync('utils/workflowRecoveryModel.ts', 'utf8');
const service = fs.readFileSync('services/workflowRecovery.ts', 'utf8');
assert(resume.includes('canAutoResume'), 'recoveryResume must expose canAutoResume.');
assert(resume.includes('loadRecoverableWorkflow'), 'recoveryResume must load recoverable journals.');
assert(resume.includes('resolveRecoveryTarget'), 'recoveryResume must map phases to retry targets.');
assert(banner.includes('恢复上一回合'), 'RecoveryBanner must offer a resume action.');
assert(app.includes('checkInterruptedWorkflow'), 'App must check for interrupted workflows on startup.');
assert(app.includes('RecoveryBanner'), 'App must render RecoveryBanner.');
assert(model.includes('pendingSettlement?:'), 'pending journal must persist a normalized frozen settlement source.');
assert(model.includes('committedState?: TeyvatGameState'), 'committed barrier must durably persist the exact normalized root.');
assert(resume.includes("{ kind: 'pending_settlement' }"), 'settlement_pending must target direct pending settlement resume.');
assert(resume.includes('runPendingSettlementRecovery'), 'pending recovery must expose explicit settlement/post-tail orchestration.');
assert(resume.includes('runCommittedSettlementRecovery'), 'committed restart must resume without settlement replay.');
assert(resume.includes('resolveCommittedRecoveryState'), 'UI eligibility and committed execution must share one historical identity validator.');
assert(resume.includes('return resolveCommittedRecoveryState(journal, currentState).ok'), 'canAutoResume must use the shared committed-state validator.');
assert(resume.includes('const resolved = resolveCommittedRecoveryState(journal, input.currentState)'), 'committed orchestration must use the same validator as UI eligibility.');
assert(app.includes('resumePendingSettlementWorkflow'), 'App must directly resume pending settlement instead of retrying a nonexistent failed batch.');
assert(app.includes('resumeCommittedSettlementWorkflow'), 'App must resume committed journals from their durable root.');
assert(!app.includes("title: '变量结算'"), 'App pending recovery must not synthesize a failed variable queue task.');
assert(app.includes('if (!result.ok)'), 'App must retain the recovery journal on explicit failure.');
assert(service.includes('await write(WORKFLOW_RECOVERY_KEY, journal)'), 'phase persistence must be an observable await barrier.');
assert(!service.includes("failed to persist journal"), 'phase persistence must not swallow write failures.');
assert(send.includes('applyAbortedWorkflowPolicy({'), 'live abort handling must gate rollback and journal clearing by settlement phase.');
assert(send.includes('committedSettlementGame.世界.当前日期'), 'live archive date must come from committed state.');
assert(send.includes('committedSettlementGame.世界.当前时间'), 'live archive clock must come from committed state.');
assert(send.includes('committedSettlementGame.世界.当前地点'), 'live archive location must come from committed state.');
assert(!send.includes('gameTime: effectiveWorld?.当前日期'), 'live archive must not read pre-command date.');
assert(!send.includes('location: effectiveWorld?.当前地点'), 'live archive must not read pre-command location.');
assert(send.includes('committedState: committedSettlementGame'), 'live committed barrier must persist the exact committed root.');
assert(!send.includes("console.error('[quest] post-commit archive failed"), 'live quest archive failure must propagate to retain settlement_committed.');
const liveCommit = send.indexOf('const committedSettlementGame = variableOverrides.committedGame');
const localCommittedPhase = send.indexOf("phase: 'settlement_committed'", liveCommit);
const abortCheckpoint = send.indexOf('assertWorkflowActive();', liveCommit);
// 顺序断言跑在拼接视图上：显式声明这三个标记必须落在同一个文件区间内，
// 否则「先后关系」可能被跨文件的偶然匹配伪造出来。
assertSpanWithinSingleFile(liveCommit, abortCheckpoint);
assert(liveCommit >= 0 && localCommittedPhase > liveCommit && abortCheckpoint > localCommittedPhase,
  'local recovery phase must advance immediately after root commit and before any abort checkpoint.');
