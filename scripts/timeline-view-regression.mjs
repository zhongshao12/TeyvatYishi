import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const builder = fs.readFileSync('utils/timelineBuilder.ts', 'utf8');
const panel = fs.readFileSync('components/features/GameSystems/TimelinePanel.tsx', 'utf8');
const menu = fs.readFileSync('data/gameMenu.ts', 'utf8');
assert(builder.includes('构建时间线'), 'timeline builder must exist.');
assert(builder.includes('kind: "steambird"'), 'timeline must merge Steambird events.');
assert(builder.includes('kind: "plot"'), 'timeline must merge plot events.');
assert(builder.includes('长期记忆'), 'timeline must merge long-term memories.');
assert(panel.includes('TimelinePanel'), 'timeline panel must exist.');
assert(panel.includes('按时间排序'), 'timeline panel must sort events.');
assert(menu.includes("id: 'timeline'"), 'game menu must register timeline entry.');
// R02（PROJECT_AUDIT_2026-10-03）：面板统一由 SystemPanels 懒加载注册、App 只引用懒加载包装，
// 所以「App 文本里出现 TimelinePanel」不再成立。契约不变（时间线面板必须挂在系统面板注册处），
// 断言随当前接线更新，而不是把直接 import 恢复回 App。
const systemPanels = fs.readFileSync('components/features/GameSystems/SystemPanels.tsx', 'utf8');
assert(systemPanels.includes('TimelinePanel'), 'SystemPanels must register TimelinePanel.');
console.log('timeline view regression ok');
