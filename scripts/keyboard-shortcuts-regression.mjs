import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const defaults = fs.readFileSync('data/keyboardShortcutDefaults.ts', 'utf8');
const hook = fs.readFileSync('hooks/useGame/useKeyboardShortcuts.ts', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
const tab = fs.readFileSync('components/features/Settings/KeyboardShortcutsTab.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
assert(defaults.includes('KEYBOARD_SHORTCUT_DEFAULTS'), 'default shortcut map must exist.');
// P0 起默认键位改为 Alt 组合键（Ctrl+R 会整页刷新丢回合），见 data/keyboardShortcutDefaults.ts 注释。
assert(defaults.includes("reroll: { key: 'r', alt: true }"), 'Alt+R must map to reroll by default.');
assert(defaults.includes("save: { key: 's', alt: true }"), 'Alt+S must map to save by default.');
assert(hook.includes('useKeyboardShortcuts'), 'shortcut hook must exist.');
assert(hook.includes("tag === 'input' || tag === 'textarea'"), 'shortcuts must not fire inside inputs.');
assert(settings.includes('keyboardShortcuts?: Record<string'), 'game settings must carry custom shortcuts.');
assert(tab.includes('KeyboardShortcutsTab'), 'shortcut settings tab must exist.');
assert(tab.includes('settings.keyboardShortcuts ?? {}'), 'shortcut editor must merge persisted bindings with defaults.');
assert(tab.includes('onChange({ ...settings, keyboardShortcuts:'), 'shortcut editor must persist custom bindings through game settings.');
assert(app.includes('useKeyboardShortcuts('), 'App must mount the shortcut hook.');
assert(app.includes('actions.handleReroll'), 'App must wire reroll shortcut to the action.');
assert(app.includes('actions.handleSave'), 'App must wire save shortcut to the action.');
console.log('keyboard shortcuts regression ok');
