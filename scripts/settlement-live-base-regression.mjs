import fs from 'node:fs';

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
assertIncludes(entry, 'const saveToken = capturePostSettlementSaveToken(liveBase);', '存档身份令牌必须取自活体根。');
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
assertIncludes(rebase, "const SETTLEMENT_MERGED_SLICES = new Set(['对话']);", '对话必须走合并而不是「冲突即保留活体值」。');
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

console.log('settlement-live-base-regression: ok');
