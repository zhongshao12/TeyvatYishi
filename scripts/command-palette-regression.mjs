import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const registry = fs.readFileSync('utils/commandRegistry.ts', 'utf8');
const palette = fs.readFileSync('components/features/Chat/CommandPalette.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
const inputArea = fs.readFileSync('components/features/Chat/InputArea.tsx', 'utf8');
assert(registry.includes('registerCommand'), 'command registry must expose registerCommand.');
assert(registry.includes('searchCommands'), 'command registry must expose searchCommands.');
assert(palette.includes('CommandPalette'), 'command palette must exist.');
assert(palette.includes('ArrowDown'), 'command palette must support keyboard navigation.');
assert(app.includes('registerCommand({ id:'), 'App must register commands.');
assert(app.includes('CommandPalette'), 'App must render command palette.');
assert(app.includes("showCommandPalette"), 'App must track palette visibility.');
assert(inputArea.includes('onCommandIntent'), 'InputArea must accept command intent callback.');
assert(inputArea.includes("next.trim() === '/'"), 'InputArea must trigger palette on slash input.');
console.log('command palette regression ok');
