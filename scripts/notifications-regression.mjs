import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const notifications = fs.readFileSync('utils/notifications.ts', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
const tab = fs.readFileSync('components/features/Settings/NotificationSettingsTab.tsx', 'utf8');
// 迁移: 主剧情工作流读取改走 readWorkflowSources()（WORKFLOW_FILES 登记文件的拼接视图）。
// 理由: 这些断言保护的是行为，不是文件位置；阶段模块拆分后代码一搬走就不再假红。
// 注: questWorkflow 仍按单文件读取——它同时被 quest-state-machine-regression.mjs 精确断言。
const sendWorkflow = readWorkflowSources();
const questWorkflow = fs.readFileSync('hooks/useGame/questWorkflow.ts', 'utf8');
assert(notifications.includes('notifyEvent'), 'notification util must expose notifyEvent.');
assert(notifications.includes('isQuietTime'), 'notification util must respect quiet hours.');
assert(notifications.includes('cooldownMs'), 'notification util must apply per-type cooldown.');
assert(settings.includes('notificationSettings?:'), 'game settings must carry notification settings.');
assert(tab.includes('NotificationSettingsTab'), 'notification settings tab must exist.');
assert(tab.includes('DEFAULT_NOTIFICATION_SETTINGS') && tab.includes('settings.notificationSettings ?? {}'), 'notification editor must normalize missing saved preferences.');
assert(tab.includes('onChange({ ...settings, notificationSettings:'), 'notification editor must persist preferences through game settings.');
assert(sendWorkflow.includes("notifyEvent(state.gameSettings.notificationSettings"), 'send workflow must trigger notifications.');
assert(questWorkflow.includes("'quest'"), 'quest workflow must notify task updates.');
console.log('notifications regression ok');
