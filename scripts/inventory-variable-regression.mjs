import fs from 'node:fs';

function assert(condition, message) { if (!condition) throw new Error(message); }

const registry = fs.readFileSync('utils/teyvatCommandRegistry.ts', 'utf8');
const transaction = fs.readFileSync('services/teyvatTurnTransaction.ts', 'utf8');
const facts = fs.readFileSync('utils/variableFacts.ts', 'utf8');
const items = fs.readFileSync('models/teyvat/items.ts', 'utf8');
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
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
assert(transaction.includes('replaceGameState(reduced.nextState)'), 'accepted transaction 必须只调用根 replace callback。');
assert(facts.includes("root: '背包', path: 'items'"), 'item facts 必须输出正式 root/path 命令。');
assert(facts.includes('category: fact.category') && facts.includes('quantity: fact.quantity') && facts.includes('rarity: fact.rarity'), 'item facts 必须输出正式 category/quantity/rarity 字段。');
assert(facts.includes('是非背包信息物品') && facts.includes('不是可放入背包的实体物品'), '事实层必须继续过滤纯信息物品。');

const calibrationStart = sendWorkflow.indexOf('async function runVariableCalibrationStep');
const calibration = sendWorkflow.slice(calibrationStart);
assert(calibration.includes('factsToTeyvatDomainCommands'), 'live variable settlement must use the formal fact translator.');
assert(calibration.includes('commitTeyvatTurn(stateSnapshot, pendingCommands, (nextState) =>'), 'live settlement must commit one formal root transaction.');
assert(calibration.includes('state.replaceGameState(committedGame)'), 'accepted live settlement must perform one root replacement.');
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
