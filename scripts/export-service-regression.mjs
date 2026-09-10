import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const service = fs.readFileSync('services/exportService.ts', 'utf8');
const modal = fs.readFileSync('components/features/SaveLoad/SaveLoadModal.tsx', 'utf8');
const app = fs.readFileSync('App.tsx', 'utf8');
assert(service.includes('导出剧情Markdown'), 'export service must export story markdown.');
assert(service.includes('导出剧情JSON'), 'export service must export story JSON.');
assert(service.includes('导出角色档案'), 'export service must export traveler profile.');
assert(service.includes('导出世界书'), 'export service must export worldbooks.');
assert(service.includes('导出相册'), 'export service must export album.');
assert(service.includes('下载文本文件'), 'export service must provide a download helper.');
assert(service.includes('解析Markdown剧情'), 'export service must parse markdown stories back.');
assert(modal.includes('单系统导出'), 'SaveLoadModal must expose single-system export buttons.');
assert(modal.includes('剧情 Markdown'), 'SaveLoadModal must export story markdown.');
assert(app.includes('chatHistory={state.chatHistory}'), 'App must pass chat history to SaveLoadModal.');
console.log('export service regression ok');
