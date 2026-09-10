import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const builder = fs.readFileSync('utils/timelineBuilder.ts', 'utf8');
const panel = fs.readFileSync('components/features/GameSystems/TimelinePanel.tsx', 'utf8');
const menu = fs.readFileSync('data/gameMenu.ts', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
assert(builder.includes('构建时间线'), 'timeline builder must exist.');
assert(builder.includes('kind: "steambird"'), 'timeline must merge Steambird events.');
assert(builder.includes('kind: "plot"'), 'timeline must merge plot events.');
assert(builder.includes('长期记忆'), 'timeline must merge long-term memories.');
assert(panel.includes('TimelinePanel'), 'timeline panel must exist.');
assert(panel.includes('按时间排序'), 'timeline panel must sort events.');
assert(menu.includes("id: 'timeline'"), 'game menu must register timeline entry.');
assert(app.includes('TimelinePanel'), 'App must render TimelinePanel.');
console.log('timeline view regression ok');
