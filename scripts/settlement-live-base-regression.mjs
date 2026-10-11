import fs from 'node:fs';
import { runFocusedBehaviorRegression } from './lib/runFocusedBehaviorRegression.mjs';

/**
 * 「结算提交必须落到活体根」的接线门禁。
 *
 * 背景（本轮用户回归，2026-09-20）：A3 的并发保护把存档身份 CAS 的基准取成了 `state.game` ——
 * 那是**本次发送开始那次渲染**的快照，连本回合的 user 消息都还没有（`prepareSendTurn` 之后才写入），
 * 于是它与提交那一刻的活体根**必然**不等（对话少一条），每一次变量结算都被判成
 * 「等待期间换了存档」而整体丢弃。用户可见症状三条：
 *   1) 聊天里每条消息的「第 N 回合」不再增长（`gameTime` = `state.turnCount`）；
 *   2) 自动存档的回合数卡住（`turnCount: state.turnCount + 1` 恒定）；
 *   3) 手机里所有新消息落在同一回合 → 回合分割线（`phone-turn-divider`）全部消失。
 *
 * 门禁断言的是**承重契约**，不是名字存在性：
 *   A) 活体根必须用 `readLiveGameState`（flushSync + 同引用返回的只读探测）同步读取；
 *   B) CAS 基准 / 并发合并祖先 / 结算快照基线都必须来自活体根，不得退回渲染快照；
 *   C) 提交结果必须如实回传（未写入时上游不得再拿 committedGame 去自动存档）；
 *   D) 对话切片必须按 id 合并（本回合新落的 assistant 消息只在结算结果里，不能被并发写入顶掉）；
 *   E) 手机回合分割线的渲染条件与「消息带活体回合」的接线不得被删。
 */

function read(path) {
  // 工作树是 CRLF，多行断言（切片边界）必须先在 LF 上做。
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(source, needle, message) {
  assert(source.includes(needle), message);
}

const gameState = read('hooks/useGameState.ts');
const sendWorkflow = read('hooks/useGame/sendWorkflow.ts');
const calibrationStage = read('hooks/useGame/variableCalibrationStage.ts');
const settlementWorkflow = read('hooks/useGame/variableSettlementWorkflow.ts');
const rebase = read('utils/settlementRebase.ts');
const courierModal = read('components/features/Courier/CourierModal.tsx');
const courierTimeline = read('components/features/Courier/CourierMessageTimeline.tsx');

// ── A) 活体根读取器 ──
assertIncludes(gameState, 'export function readLiveGameState(', '必须导出 readLiveGameState：长耗时流程需要同步读活体根，而不是渲染快照。');
const liveReader = gameState.slice(gameState.indexOf('export function readLiveGameState('));
const liveReaderBody = liveReader.slice(0, liveReader.indexOf('\n}\n') + 1);
assertIncludes(liveReaderBody, 'flushSync(', 'readLiveGameState 必须用 flushSync 同步拿到活体根（渲染快照可能落后于未刷新的写入）。');
assertIncludes(liveReaderBody, 'return current;', 'readLiveGameState 必须同引用返回：这次更新不得改变状态（代价是 flushSync 会真的渲染一次，见该函数注释与 tests/unit/liveGameStateRead.test.ts）。');

// ── B) CAS 基准 / 合并祖先 / 快照基线 ──
const entryStart = sendWorkflow.indexOf('export async function runVariableCalibrationStep');
assert(entryStart !== -1, '找不到变量结算入口 runVariableCalibrationStep。');
const entry = sendWorkflow.slice(entryStart);
assertIncludes(entry, 'readLiveGameState(state)', '结算入口必须同步读取活体根作为基准。');
assertIncludes(entry, 'const settlementSessionId = state.getGameSessionId();', '结算身份必须取运行时 session：聊天裁剪不是切档，相同聊天也不代表同一份存档。');
assert(entry.indexOf('const settlementSessionId') < entry.indexOf('await import('), '必须在异步模块加载前捕获 session 身份。');
assertIncludes(entry, 'state.getGameSessionId() !== settlementSessionId', '提交必须拒绝等待期间切换的 session。');
assertIncludes(entry, 'liveNow.turnCount !== liveBase.turnCount', '提交必须拒绝已推进或回退的回合。');
assertIncludes(entry, 'const liveNow = readLiveGameState(state);', '提交前必须再同步读一次活体根做 CAS，而不是在 updater 里被动等待。');
assertIncludes(entry, 'rebaseSettlementState({ ancestor: liveBase,', '并发合并的祖先必须是结算开始时的活体根。');
assert(
  !entry.includes('capturePostSettlementSaveToken(state.game)') && !entry.includes('capturePostSettlementSaveToken(trueBase)'),
  'CAS 基准不得是渲染快照（state.game / trueBase）：它比活体根少本回合 user 消息，会把每次结算都判成「换了存档」。',
);
assert(
  !entry.includes('const trueBase = state.game;') && !entry.includes('const frozenBase ='),
  '结算入口不得再用渲染快照拼「真基线/冻结基线」：两者都不是可与活体根比较引用的一手来源。',
);

assertIncludes(
  calibrationStage,
  'const liveBaseGame = readLiveGameState(state);',
  '结算快照的基线必须是活体根：用 state.game 会让变量模型看到过期状态（并且与提交时的 CAS 基准不一致）。',
);
assertIncludes(
  calibrationStage,
  'applyLegacyGameStateOverrides(liveBaseGame, {',
  '结算快照必须基于活体根构建。',
);
assertIncludes(calibrationStage, 'liveBaseGame,', '活体根必须传给 runVariableCalibrationStep（CAS 与合并都要用同一份基准）。');

// ── C) 提交结果如实回传 ──
assertIncludes(
  settlementWorkflow,
  'committedApplied = params.commitGame(committedGame) !== false;',
  '结算工作流必须记录提交是否真的落到活体根上。',
);
assertIncludes(
  settlementWorkflow,
  'if (transaction.status !== \'committed\' || !committedGame || !committedApplied) {',
  'CAS 拒绝时不得把 committedGame 交回上游：否则元素结算/后台任务/自动存档会把旧档的结算写进新档。',
);
assertIncludes(
  settlementWorkflow,
  'commitGame: (next: TeyvatGameState) => boolean;',
  'commitGame 的提交契约必须是 boolean（未写入要能如实上报）。',
);

// ── D) 对话切片按 id 合并 ──
assertIncludes(rebase, 'ancestor: TeyvatGameState;', '并发判定基准必须叫 ancestor（活体根）。');
assert(
  !rebase.includes('trueBase') && !rebase.includes('frozenBase'),
  'settlementRebase 不得再引用渲染快照/归一化快照当基准（引用必然不等 → 全部切片被误判成冲突）。',
);
assertIncludes(rebase, 'if (currentSlice === ancestorRecord[key]) continue;', '只有「引用变了」才算等待期间的并发写入。');
// B06（PROJECT_AUDIT_2026-10-03）：叙事切片改为**结算专属子字段合并**
// （lastCommittedMoment / variableBatches 取结算结果，玩家编辑的剧情字段以活体为底保留），
// 对话仍按 id 合并。契约不变：并发编辑不得被顶掉，本回合的时刻也不得丢。
assertIncludes(rebase, "const SETTLEMENT_MERGED_SLICES = new Set(['对话', '叙事']);", '对话与叙事必须走合并而不是「冲突即保留活体值」。');
assertIncludes(rebase, 'SETTLEMENT_OWNED_NARRATIVE_FIELDS', '叙事必须按结算专属子字段合并（时刻不丢、玩家编辑保留）。');
assertIncludes(rebase, 'function mergeConversation(', '对话合并必须按 id 取活体版本 + 保留结算新增条目。');

// ── E) 手机回合分割线（用户可见症状 3） ──
assertIncludes(
  courierTimeline,
  'data-testid="phone-turn-divider"',
  '手机消息必须保留「不同回合」的分割线渲染。',
);
assertIncludes(
  courierTimeline,
  'startsNewTurn={index > 0 && visibleMessages[index - 1]?.turn !== message.turn}',
  '回合分割线必须按前后两条消息的回合号是否变化来决定渲染。',
);
assertIncludes(
  courierModal,
  'turn: resolveCourierMessageTurn(currentTurn, selected.messages),',
  '玩家发出的手机消息必须带当前活体回合号，否则同一回合的消息会连成一片、分割线消失。',
);

// ── F) 基线归属 + 恢复入口（对抗审查 2026-09-20 第 1 条：跨存档整份覆盖） ──
assertIncludes(
  rebase,
  'export function isSettlementBaseCompatibleWithLiveRoot(',
  '必须提供「结算基线是否属于当前活体存档」的判定（journal 里的冻结根属于旧档，CAS 拦不住跨档基线）。',
);
assertIncludes(
  entry,
  'isSettlementBaseCompatibleWithLiveRoot(settlement.baseGameSnapshot, liveBase)',
  '结算入口必须在调用模型之前拒绝「来自另一份存档」的基线（纵深防御：不依赖调用方自觉）。',
);
const recoveryResumeSource = read('hooks/useGame/recoveryResume.ts');
assertIncludes(
  recoveryResumeSource,
  'export function resolvePendingRecoveryEligibility(',
  'settlement_pending 必须有身份校验（与 committed 阶段的 resolveCommittedRecoveryState 对称）。',
);
assertIncludes(
  recoveryResumeSource,
  'return resolvePendingRecoveryEligibility(journal, currentState, options).ok;',
  'canAutoResume 必须与执行时共用同一个 pending 身份校验器（界面不得提供一个执行时必然被拒的入口）。',
);
assert(
  recoveryResumeSource.indexOf('resolvePendingRecoveryEligibility(journal, input.currentState)')
    < recoveryResumeSource.indexOf('input.settle('),
  '身份校验必须在 settle 之前：settle 会把 journal 里旧档的冻结根写进当前活体存档。',
);

// ── G) 恢复尾流程不得整根替换（对抗审查 2026-09-20 第 2 条：A3 类） ──
// The recovery finalizer now applies task deltas after the slice rebase. Verify
// the original safety contract through real concurrent writes and React CAS,
// instead of requiring an exact assignment/call spelling from the old version.
runFocusedBehaviorRegression([
  'tests/unit/postSettlementRecoveryCommitCas.test.ts',
  'tests/unit/postSettlementRecovery.test.ts',
  'tests/unit/recoveryTailParity.test.ts',
]);

// ── H) 手机回信的 NPC 写回（对抗审查 2026-09-20 第 4 条） ──
const appSource = read('App.tsx');
assertIncludes(
  appSource,
  'afterReveal.setNPC((previous) => mergeNpcWriteBack({',
  '手机回信的 NPC 写回必须按 id 与活体根合并：整片 setNPC(result.npcs) 会把飞行期间结算/玩家的 NPC 写入顶掉。',
);
assert(!appSource.includes('state.setNPC(result.npcs);'), 'App 不得再整片写回回信作业的 NPC 快照。');

console.log('settlement-live-base-regression: ok');
