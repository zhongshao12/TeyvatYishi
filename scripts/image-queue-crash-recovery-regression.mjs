import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const queue = fs.readFileSync('utils/imageTaskQueue.ts', 'utf8');
assert(queue.includes('recoverStaleTasks'), 'queue must expose crash recovery for stale running tasks.');
assert(queue.includes('STALE_RUNNING_MS'), 'crash recovery must use a stale-running threshold.');
assert(queue.includes('任务被中断'), 'crash recovery must explain the interruption.');
