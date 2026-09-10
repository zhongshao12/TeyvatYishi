import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const notifications = fs.readFileSync('utils/notifications.ts', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
const tab = fs.readFileSync('components/features/Settings/NotificationSettingsTab.tsx', 'utf8');
const sendWorkflow = fs.readFileSync('hooks/useGame/sendWorkflow.ts', 'utf8');
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
