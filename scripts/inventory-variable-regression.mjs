import fs from 'node:fs';
import { readWorkflowFile, readWorkflowSources } from './lib/workflowSources.mjs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const registry = fs.readFileSync('utils/teyvatCommandRegistry.ts', 'utf8');
const transaction = fs.readFileSync('services/teyvatTurnTransaction.ts', 'utf8');
const facts = fs.readFileSync('utils/variableFacts.ts', 'utf8');
const items = fs.readFileSync('models/teyvat/items.ts', 'utf8');
const sendWorkflow = readWorkflowSources();
const variableModel = fs.readFileSync('services/ai/variableModel.ts', 'utf8');
const variableWorldbook = fs.readFileSync('data/variableWorldbook.ts', 'utf8');
const domainRules = fs.readFileSync('prompts/subsystems/domainCommandPrompt.ts', 'utf8');
const domainOutputFormat = fs.readFileSync('prompts/subsystems/domainCommandOutputFormat.ts', 'utf8');

assert(registry.includes("command.path === 'items'"), '正式领域登记表必须暴露 root=背包,path=items。');
assert(registry.includes("case '背包': return applyInventory"), '背包必须由正式 Teyvat registry 的显式 reducer 处理。');
assert(registry.includes('ITEM_CATEGORIES') && registry.includes('ITEM_RARITIES'), '正式登记表必须复用物品枚举。');
assert(registry.includes("validateAction(command, ['push']"), '背包 items 新增必须限定为 push。');
assert(registry.includes('ITEM_QUANTITY_RE') && registry.includes("['set', 'add', 'sub']"), '物品数量更新必须限定稳定 item id 与数值动作。');
assert(registry.includes('state.背包.items.findIndex((item) => item.id === quantity[1])'), '物品数量更新必须精确匹配 item.id。');
assert(registry.includes("root === '旅行者'") && registry.includes("path.startsWith('背包')"), '旅行者侧背包镜像必须作为 legacy path 拒绝。');

assert(transaction.includes('reduceTeyvatTurn') && transaction.includes('commitTeyvatTurn'), '背包必须经过正式根 transaction。');
assert(transaction.includes('if (errors.length) return { status: \'rejected\', nextState: initial'), '混合失败批次必须返回原始根状态。');
// 迁移: 旧 `replaceGameState(reduced.nextState)`（accepted 分支直呼根 replace callback）
//   -> `replaceGameState(nextState);`（services/teyvatTurnTransaction.ts 的 commitPreflightedTeyvatTurn，
//      入参先 `normalizeTeyvatGameState(preflight.nextState)` 再交给根 callback）。
// 理由: 意图不变且更严——accepted 事务只准调用根 replace callback 一次；rejected 分支（errors.length 时
//       直接返回原始 initial）不经过任何 callback。因此断言“根 callback 调用点恰好一处 + 传的是根状态”。
const replaceGameStateCalls = [...transaction.matchAll(/replaceGameState\(/g)];
assert(replaceGameStateCalls.length === 1 && transaction.includes('replaceGameState(nextState);'), 'accepted transaction 必须只调用根 replace callback。');
assert(facts.includes("root: '背包', path: 'items'"), 'item facts 必须输出正式 root/path 命令。');
assert(facts.includes('category: fact.category') && facts.includes('quantity: fact.quantity') && facts.includes('rarity: fact.rarity'), 'item facts 必须输出正式 category/quantity/rarity 字段。');
assert(facts.includes('是非背包信息物品') && facts.includes('不是可放入背包的实体物品'), '事实层必须继续过滤纯信息物品。');

// 迁移: 旧切片 `sendWorkflow.slice(indexOf('async function runVariableCalibrationStep'))` 假设「校准入口之后就是结算实现本体」
//   （当时 sendWorkflow 是单文件）。重构后结算实现搬到 hooks/useGame/variableSettlementWorkflow.ts，而
//   WORKFLOW_FILES 仍在其后继续拼接 turnSnapshot/memoryUtils/postSettlementCommitStage 等无关模块，
//   尾部切片会把它们误当结算代码——例如 turnSnapshot.ts 的旧存档恢复 `state.set背包(` 就会让下面的负断言假红。
//   -> 切片改为显式取「校准入口（sendWorkflow.ts 尾部）」+「正式结算实现模块」两段。
// 理由: live 结算链路范围不变（入口 + 实现），负断言既不空转也不误伤无关模块。
const calibrationEntry = readWorkflowFile('hooks/useGame/sendWorkflow.ts');
const calibrationStart = calibrationEntry.indexOf('async function runVariableCalibrationStep');
assert(calibrationStart !== -1, 'live settlement entry point must be present.');
const calibration = [
  calibrationEntry.slice(calibrationStart),
  readWorkflowFile('hooks/useGame/variableSettlementWorkflow.ts'),
].join('\n');
assert(calibration.includes('factsToTeyvatDomainCommands'), 'live variable settlement must use the formal fact translator.');
// 迁移: 旧 `commitTeyvatTurn(stateSnapshot, pendingCommands, (nextState) => ...`（内联箭头根 callback）
//   -> `commitTeyvatTurn(stateSnapshot, pendingCommands, commitGameState, evidenceContext)`（具名 callback + 证据上下文）。
// 理由: 意图不变——live 结算仍必须走一次正式根 transaction。
assert(calibration.includes('commitTeyvatTurn(stateSnapshot, pendingCommands, commitGameState, evidenceContext)'), 'live settlement must commit one formal root transaction.');
// 迁移: 旧 `commitGame: (next) => state.updateGameState(() => next),`（忽略 current 的整根替换）
//   -> 入口改为「同步读活体根做存档身份 CAS + 按顶层切片三路合并」：
//      `commitGame: (next) => { const liveNow = readLiveGameState(state); ... rebaseSettlementState({ ancestor: liveBase, ... }) ... }`。
// 理由: 旧写法会静默丢弃玩家在变量模型等待期间（可达数十秒）对背包/NPC/任务/相册的改动
//       —— 第二轮审计 A3。意图不变且更严：accepted live 结算仍只准有一个根提交调用点，
//       且该调用点必须经过并发保护（CAS + 合并），不得退回无条件整根替换。
// 迁移（本轮用户回归）: CAS 基准必须来自 `readLiveGameState(state)`（活体根），
//   不得用 `state.game` / `trueBase`（渲染快照，比活体根少本回合 user 消息 → 每次结算都被判成
//   「等待期间换了存档」而整体丢弃，症状是 turnCount 不再增长、手机回合分割线消失）；
//   提交结果必须如实回传（`committedApplied`），否则上游会拿没落地的结算去自动存档。
const commitGameCalls = [...calibration.matchAll(/params\.commitGame\(/g)];
assert(
  /commitGame:\s*\(next\)\s*=>\s*\{/.test(calibration)
  && calibration.includes('readLiveGameState(state)')
  && calibration.includes('rebaseSettlementState({ ancestor: liveBase,')
  && calibration.includes('isSamePostSettlementSave(')
  && calibration.includes('committedApplied = params.commitGame(committedGame) !== false;')
  && commitGameCalls.length === 1,
  'accepted live settlement must perform one guarded root commit.',
);
assert(
  !calibration.includes('commitGame: (next) => state.updateGameState(() => next),'),
  '结算提交不得退回「忽略 current 的整根替换」：会静默丢弃玩家等待期间的改动（第二轮审计 A3）。',
);
assert(
  !calibration.includes('capturePostSettlementSaveToken(state.game)')
  && !calibration.includes('capturePostSettlementSaveToken(trueBase)'),
  '存档身份 CAS 的基准不得是渲染快照（state.game / trueBase）：它与提交那一刻的活体根必然不等，会把每次结算都判成「换了存档」。',
);
assert(!calibration.includes('commitVariableState') && !calibration.includes('reduceVariableCommands'), 'live settlement must not call the legacy executor.');
assert(!calibration.includes('state.set背包('), 'live synchronous settlement must not commit inventory through a slice setter.');
assert(sendWorkflow.includes('背包: state.背包'), 'pre-turn snapshot must carry the formal inventory root.');
assert(sendWorkflow.includes('背包: committedSettlementGame.背包'), 'autosave must consume committed inventory, not a pre-commit slice.');

assert(items.includes("['weapon', 'artifact', 'food', 'material', 'gadget', 'quest', 'furnishing']"), '物品模型必须声明七类提瓦特分类。');
assert(items.includes('[1, 2, 3, 4, 5]') && items.includes("['flower', 'plume', 'sands', 'goblet', 'circlet']"), '物品模型必须声明 1-5 星和圣遗物五部位。');
assert(items.includes("throw new Error('LEGACY_ITEM_FIELD_NOT_ALLOWED')"), '正式 normalizer 必须明确拒绝 legacy item keys。');

assert(variableWorldbook.includes('正式 item facts') && variableWorldbook.includes('items'), '领域事实说明必须继续指向正式背包 items。');
assert(variableModel.includes('DOMAIN_COMMAND_RULES_PROMPT') && variableModel.includes('DOMAIN_COMMAND_OUTPUT_FORMAT_PROMPT'), '变量模型必须直接装配原生领域规则与输出契约。');
for (const source of [variableWorldbook, domainRules, domainOutputFormat]) {
  assert(source.includes('rarity') && source.includes('quantity'), '提示词必须使用正式 rarity/quantity 字段。');
  assert(source.includes('weapon') && source.includes('artifact') && source.includes('furnishing'), '提示词必须覆盖正式提瓦特分类。');
  assert(source.includes('flower') && source.includes('circlet'), '提示词必须声明圣遗物五部位。');
  assert(source.includes('坐标') && source.includes('信息') && source.includes('实体'), '提示词必须明确纯信息不是实体背包物品。');
}

console.log('inventory variable regression ok');
