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
assert(panel.includes('RelationshipGraphPanel'), 'relationship graph panel must exist.');
assert(panel.includes('最近好感变化'), 'graph panel must show affinity history.');
assert(companion.includes('关系图'), 'CompanionPanel must expose a graph tab.');
assert(companion.includes('RelationshipGraphPanel'), 'CompanionPanel must render the graph panel.');
assert(companion.includes('variableBatches'), 'CompanionPanel must accept variable batches.');
assert(app.includes('variableBatches: state.variableBatches'), 'App must pass variable batches.');
console.log('relationship graph regression ok');
