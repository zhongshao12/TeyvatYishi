import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const graph = fs.readFileSync('utils/relationshipGraph.ts', 'utf8');
const panel = fs.readFileSync('components/features/GameSystems/RelationshipGraphPanel.tsx', 'utf8');
// 迁移: 伙伴面板侧栏已从 CompanionPanel.tsx 抽到 components/features/GameSystems/companion/CompanionRosterSidebar.tsx，
// 理由: 伙伴面板拆分；「关系图」页签标签随侧栏一起搬迁，两文件合读。
const companion = [
  fs.readFileSync('components/features/GameSystems/CompanionPanel.tsx', 'utf8'),
  fs.readFileSync('components/features/GameSystems/companion/CompanionRosterSidebar.tsx', 'utf8'),
].join('\n');
const app = fs.readFileSync('App.tsx', 'utf8');
assert(graph.includes('构建关系图'), 'relationship graph util must build graphs.');
assert(graph.includes('提取好感变化事件'), 'relationship graph util must extract affinity events.');
// 行为断言，而不是只断言函数名：结算回执里的 NPC 路径字段是**英文 affinity**
// （variableSettlementWorkflow 用 `${root}.${path}` 组装），中文「好感度」只出现在旧批次里。
// 只按中文字段名筛选会让面板永远显示「暂无好感变化记录」——门禁当时只查了函数名，所以全绿。
assert(/affinity/.test(graph), '好感变化事件必须识别现行英文 affinity 字段。');
assert(graph.includes('好感度'), '旧存档批次里的中文「好感度」key 仍必须能显示。');
assert(!/includes\("好感度"\)/.test(graph), '禁止只用中文「好感度」筛选 key：现行回执里没有这三个字。');
assert(!/action === "sub" \? -numeric : numeric/.test(graph), 'set 命令是绝对值，不能当增量显示。');
assert(panel.includes('RelationshipGraphPanel'), 'relationship graph panel must exist.');
assert(panel.includes('最近好感变化'), 'graph panel must show affinity history.');
assert(panel.includes('resolveNpcName'), '关系图面板必须把批次里的稳定 id 解析成显示名。');
assert(companion.includes('关系图'), 'CompanionPanel must expose a graph tab.');
assert(companion.includes('RelationshipGraphPanel'), 'CompanionPanel must render the graph panel.');
assert(companion.includes('variableBatches'), 'CompanionPanel must accept variable batches.');
assert(app.includes('variableBatches: state.variableBatches'), 'App must pass variable batches.');
console.log('relationship graph regression ok');
