import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const album = fs.readFileSync('components/features/GameSystems/AlbumPanel.tsx', 'utf8');
const queue = fs.readFileSync('utils/imageTaskQueue.ts', 'utf8');
const retry = fs.readFileSync('utils/imageGenerationRetry.ts', 'utf8');
const queueTest = fs.readFileSync('tests/unit/imageTaskQueue.test.ts', 'utf8');
assert(album.includes('createRunner((_taskId, signal)'), 'album must forward the queue abort signal to the generation runner.');
assert(album.includes('signal: innerSignal'), 'album must forward the abort signal into generateImage.');
assert(retry.includes('runner(options?.signal)'), 'retry util must forward signal into the runner.');
assert(queue.includes('controller.signal.aborted'), 'queue must re-check abort state after executor returns.');
assert(queue.includes('任务已取消。'), 'queue must resolve cancelled executions as failed.');
assert(queueTest.includes('treats a cancelled executor that still resolves as failed'), 'queue unit test must cover late-success cancellation.');
console.log('image queue cancel regression ok');
