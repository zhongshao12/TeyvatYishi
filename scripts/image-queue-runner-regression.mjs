import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const queue = fs.readFileSync('utils/imageTaskQueue.ts', 'utf8');
const album = fs.readFileSync('components/features/GameSystems/AlbumPanel.tsx', 'utf8');
const taskWs = fs.readFileSync('components/features/GameSystems/album/taskWorkspace.tsx', 'utf8');
const settings = fs.readFileSync('models/settings.ts', 'utf8');
const settingsTab = fs.readFileSync('components/features/Settings/ImageGenerationSettingsTab.tsx', 'utf8');
assert(queue.includes('createImageTaskQueue'), 'queue engine must be exported.');
assert(queue.includes('concurrency'), 'queue engine must support concurrency.');
assert(queue.includes('maxRetries'), 'queue engine must support retry limits.');
assert(queue.includes('globalImageTaskQueue'), 'queue engine must export a shared singleton.');
assert(album.includes('recoverStaleTasks'), 'album must recover stale running tasks on load.');
assert(album.includes("status: 'queued'"), 'album must enqueue tasks with queued status.');
assert(album.includes('handleCancelTask'), 'album must expose a cancel handler.');
assert(taskWs.includes('onCancel'), 'task workspace must accept a cancel callback.');
assert(taskWs.includes('取消'), 'task workspace must render a cancel button for queued tasks.');
assert(settings.includes('并发数') && settings.includes('最大重试次数'), 'image settings must expose concurrency and max retries.');
assert(settingsTab.includes('并发数') && settingsTab.includes('最大重试次数'), 'settings tab must render queue config inputs.');
