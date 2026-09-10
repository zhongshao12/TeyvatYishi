import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const policy = fs.readFileSync('services/ai/connectionTestPolicy.ts', 'utf8');
const apiSettings = fs.readFileSync('components/features/Settings/ApiSettings.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');

assert(policy.includes('export async function quickTestApiConfig'), 'policy must export quick test helper.');
assert(policy.includes("import { testConnection } from './apiTools'"), 'helper must reuse testConnection.');
assert(policy.includes('result.ok === true'), 'helper must gate on ok result.');

assert(apiSettings.includes('const handleActivate'), 'API settings must expose the current profile activation handler.');
assert(apiSettings.includes('onChange({ ...settings, activeConfigId: selectedConfig.id })'), 'activating a profile must update activeConfigId without mutating other profiles.');
assert(apiSettings.includes("settings.activeConfigId === selectedConfig.id ? '◆' : '◇'"), 'API settings must identify the active profile.');
assert(app.includes('state.apiSettings.configs.find((item) => item.id === state.apiSettings.activeConfigId)'), 'runtime consumers must resolve the active model profile by id.');
assert(app.includes('state.apiSettings.configs[0] ?? null'), 'runtime consumers must retain a first-profile fallback.');

console.log('model quick switch regression ok');
