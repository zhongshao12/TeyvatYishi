import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const app = fs.readFileSync('App.tsx', 'utf8');
const menu = fs.readFileSync('data/gameMenu.ts', 'utf8');
const promptBuilder = fs.readFileSync('hooks/useGame/systemPromptBuilder.ts', 'utf8');
const variableWorldbook = fs.readFileSync('data/variableWorldbook.ts', 'utf8');
const variableModel = fs.readFileSync('services/ai/variableModel.ts', 'utf8');
const domainOutputFormat = fs.readFileSync('prompts/subsystems/domainCommandOutputFormat.ts', 'utf8');
const mainNarrative = fs.readFileSync('prompts/narrative/mainPrompt.ts', 'utf8');
const builtinPromptModules = fs.readFileSync('data/builtinPromptModules.ts', 'utf8');
const inventoryPanel = fs.readFileSync('components/features/GameSystems/InventoryPanel.tsx', 'utf8');
const systemPanels = fs.readFileSync('components/features/GameSystems/SystemPanels.tsx', 'utf8');
const inventoryActions = fs.readFileSync('utils/inventoryActions.ts', 'utf8');
const itemModel = fs.readFileSync('models/teyvat/items.ts', 'utf8');
const characterModel = fs.readFileSync('models/character.ts', 'utf8');
const variableExecutor = fs.readFileSync('utils/variableExecutor.ts', 'utf8');
const variableRegistry = fs.readFileSync('utils/variableRegistry.ts', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert(!menu.includes("| 'equipment'") && !menu.includes("id: 'equipment'"), '系统菜单不得恢复 equipment。');
assert(!app.includes('EquipmentPanel') && !app.includes("case 'equipment'"), 'App 不得恢复装备面板。');
assert(!fs.existsSync('components/features/GameSystems/EquipmentPanel.tsx'), '旧装备面板必须保持退役。');
assert(!systemPanels.includes('export function EquipmentPanel'), '系统占位面板不得恢复 EquipmentPanel。');
assert(!fs.existsSync('models/equipment.ts'), '旧装备模型必须保持退役。');
assert(!fs.existsSync('models/inventory.ts'), '旧双库存模型必须删除。');

assert(!promptBuilder.includes('buildEquipmentSection') && !promptBuilder.includes('# 已穿戴装备'), '主提示词不得构建旧装备注入段。');
assert(promptBuilder.includes('artifactSlot') && promptBuilder.includes('背包.items'), '主提示词必须使用正式圣遗物部位和背包根。');
assert(variableWorldbook.includes('禁止恢复旧颜色品质、旧装备槽位、穿戴状态'), '领域事实世界书必须拒绝退役装备字段。');
assert(
  variableModel.includes('VARIABLE_SYSTEM_WORLDBOOK_PROMPT')
    && variableModel.includes('DOMAIN_COMMAND_OUTPUT_FORMAT_PROMPT')
    && domainOutputFormat.includes('item.category 只能为 weapon / artifact / food / material / gadget / quest / furnishing')
    && domainOutputFormat.includes('artifactSlot 只能为 flower / plume / sands / goblet / circlet')
    && domainOutputFormat.includes('不输出调试过程、内部推理、旧路径命令或第二个载荷'),
  '变量模型必须通过原生领域事实协议与世界书拒绝退役装备字段。',
);
assert(mainNarrative.includes('factCandidates') && builtinPromptModules.includes('inventory'), '原生主叙事必须通过正式候选事实承接背包物品。');
assert(!mainNarrative.includes('背包/装备'), '原生主叙事不得恢复旧装备状态域。');

for (const source of [inventoryPanel, inventoryActions, itemModel, variableExecutor]) {
  assert(!source.includes('当前装备部位') && !source.includes('属性加成'), '正式背包链不得声明旧穿戴或数值加成字段。');
}
assert(!inventoryPanel.includes('穿戴物品') && !inventoryPanel.includes('卸下槽位') && !inventoryPanel.includes('已穿戴'), '背包 UI 不得恢复穿戴操作或状态。');
assert(!inventoryActions.includes('export function 穿戴物品') && !inventoryActions.includes('export function 卸下槽位'), '背包 actions 不得恢复穿戴 API。');
assert(itemModel.includes("export const ARTIFACT_SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet']"), '圣遗物仅使用正式五部位。');
assert(!characterModel.includes('type 旧装备槽位ID') && !characterModel.includes('背包:'), '旅人模型不得声明旧装备或背包镜像。');
assert(!variableRegistry.includes('set 旅人.装备') && !variableRegistry.includes("path: '旅人.背包'"), '变量登记表不得暴露旅人装备或背包镜像。');
assert(variableRegistry.includes('禁止写 lightcone、颜色品质、装备槽位或穿戴状态'), '变量登记表必须拒绝旧分类、品质与穿戴字段。');

assert(
  pkg.scripts?.['test:equipment-retirement'] === 'node scripts/equipment-retirement-regression.mjs',
  'package.json 必须保留 equipment retirement 回归入口。',
);

console.log('equipment retirement regression passed');
