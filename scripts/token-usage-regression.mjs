import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const chatModel = fs.readFileSync('models/chat.ts', 'utf8');
const stats = fs.readFileSync('utils/tokenUsageStats.ts', 'utf8');
const meter = fs.readFileSync('components/features/Chat/TokenMeter.tsx', 'utf8');
const panel = fs.readFileSync('components/features/Settings/TokenStatsPanel.tsx', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
// 迁移: 主剧情工作流读取改走 readWorkflowSources()（WORKFLOW_FILES 登记文件的拼接视图）。
// 理由: 这些断言保护的是行为，不是文件位置；阶段模块拆分后代码一搬走就不再假红。
const sendWorkflow = readWorkflowSources();
const app = fs.readFileSync('App.tsx', 'utf8');
assert(chatModel.includes('system?: string'), 'turn token usage must carry a system tag.');
assert(stats.includes('累计Token用量'), 'token stats util must aggregate totals.');
assert(stats.includes('拆分Token用量'), 'token stats util must split by system.');
assert(stats.includes('是否超预算'), 'token stats util must detect budget overflow.');
assert(meter.includes('TokenMeter'), 'TokenMeter must exist.');
assert(meter.includes('超出预算'), 'TokenMeter must flag budget overflow.');
assert(panel.includes('TokenStatsPanel'), 'TokenStatsPanel must exist.');
assert(settings.includes('tokenStats?: { enabled: boolean; budgetTokens?: number }'), 'game settings must carry token stats config.');
assert(sendWorkflow.includes("system: 'main_story'"), 'main story usage must be tagged main_story.');
assert(app.includes('const sessionTokenTotals = useMemo(() => 累计Token用量(state.chatHistory)'), 'App must aggregate formal chat-history token usage.');
assert(app.includes('<TokenMeter') && app.includes('budgetTokens={state.gameSettings.tokenStats?.enabled'), 'App must render TokenMeter with the local budget preference.');
console.log('token usage regression ok');
