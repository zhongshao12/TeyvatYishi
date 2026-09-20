import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transform } from 'esbuild';

import {
  buildSaveCatalogSnapshot,
  createCatalogRecordFromSummary,
  createHiddenDeltaBaseCatalogRecord,
  createUnreadableSaveCatalogRecord,
  normalizeSaveCatalogRecord,
} from '../services/storage/saveCatalog.ts';
import {
  runWithSaveMutationPriority,
  startSaveCatalogRepairTask,
} from '../services/storage/saveCatalogRepair.ts';

const dbServiceSource = fs.readFileSync('services/dbService.ts', 'utf8');
const summarizeStart = dbServiceSource.indexOf('function summarizeSave');
const summarizeEnd = dbServiceSource.indexOf('function estimateSaveSize');
assert(summarizeStart >= 0 && summarizeEnd > summarizeStart, '必须保留独立的存档摘要边界。');
const summarizeModuleSource = dbServiceSource
  .slice(summarizeStart, summarizeEnd)
  .replace('function summarizeSave', 'export function summarizeSave');
const summarizeModule = await transform(summarizeModuleSource, { loader: 'ts', format: 'esm' });
const { summarizeSave } = await import(`data:text/javascript;base64,${Buffer.from(summarizeModule.code).toString('base64')}`);

assert.equal(summarizeSave({
  universe: 'teyvat',
  对话: {
    entries: [{
      role: 'assistant',
      content: 'raw fallback',
      structuredResponse: {
        body: [
          { kind: 'narration', text: '风从蒙德城门吹来。' },
          { kind: 'dialogue', speaker: '安柏', text: '跟我来吧。' },
        ],
      },
    }],
  },
}), '风从蒙德城门吹来。 跟我来吧。', '正式 NarrativeTurn body 必须生成可见存档摘要。');
assert.equal(summarizeSave({
  chatHistory: [{ role: 'assistant', parsedResponse: { body: '旧正文' }, content: 'raw fallback' }],
}), '旧正文', '历史字符串 body 必须继续生成存档摘要。');

function summary(id, type, timestamp = id) {
  return {
    universe: 'legacy-hsr',
    schemaVersion: 1,
    id,
    type,
    timestamp,
    travelerName: `旅人${id}`,
    turnCount: id,
    worldPeriodName: '',
    currentDate: '',
    currentTime: '',
    currentLocation: '',
    lastSummary: '',
    sizeBytes: 1024,
  };
}

const records = [
  createCatalogRecordFromSummary(summary(1, 'manual')),
  createCatalogRecordFromSummary(summary(2, 'auto')),
  createCatalogRecordFromSummary(summary(3, 'imported')),
  createCatalogRecordFromSummary(summary(4, 'backup')),
  createHiddenDeltaBaseCatalogRecord({ id: 5, universe: 'legacy-hsr', schemaVersion: 1, type: 'auto', timestamp: 5 }),
];
const complete = buildSaveCatalogSnapshot(records, [1, 2, 3, 4, 5]);
assert.deepEqual(complete.items.map((item) => item.id), [3, 2, 1], '主目录必须包含手动、自动和导入节点。');
assert.deepEqual(complete.legacyBackups.map((item) => item.id), [4], '旧 backup 必须从主目录分离。');
assert.equal(complete.hiddenBaseCount, 1, '隐藏增量基底必须有轻量目录标记。');
assert.equal(complete.catalogComplete, true, '所有主键都有目录记录时必须判定完整。');

const { universe: _legacyUniverse, schemaVersion: _legacySchemaVersion, ...historicalUnmarked } = summary(7, 'manual');
const normalizedHistorical = normalizeSaveCatalogRecord({
  ...historicalUnmarked,
  catalogVersion: 2,
  visibility: 'visible',
});
assert.equal(normalizedHistorical?.universe, 'legacy-hsr', '仅历史读取边界允许无标记目录记录回退 legacy-hsr。');
assert.equal(normalizedHistorical?.schemaVersion, 1, '仅历史读取边界允许无标记目录记录回退 schemaVersion=1。');

const missing = buildSaveCatalogSnapshot(records, [1, 2, 3, 4, 5, 6]);
assert.deepEqual(missing.pendingIds, [6], '缺失摘要必须只返回对应主键。');
assert.equal(missing.catalogComplete, false, '存在缺失摘要时不得允许依赖完整目录的操作。');

const unreadable = buildSaveCatalogSnapshot([
  ...records,
  createUnreadableSaveCatalogRecord({ id: 6, universe: 'legacy-hsr', schemaVersion: 1, error: new Error('broken') }),
], [1, 2, 3, 4, 5, 6]);
assert.deepEqual(unreadable.unreadableIds, [6], '不可读节点必须保留故障标记。');
assert.equal(unreadable.catalogComplete, false, '不可读节点存在时整树目录仍不完整。');

let releaseFirst;
let firstStarted;
const firstStartedPromise = new Promise((resolve) => {
  firstStarted = resolve;
});
const firstGate = new Promise((resolve) => {
  releaseFirst = resolve;
});
const repaired = [];
const operations = {
  collectIds: async () => [11, 12],
  repairOne: async (id) => {
    repaired.push(id);
    if (id === 11) {
      firstStarted();
      await firstGate;
    }
  },
  cleanupStaleRecords: async () => {},
  acquireLease: async () => true,
  renewLease: async () => {},
  releaseLease: async () => {},
};

const firstRepair = startSaveCatalogRepairTask('missing-only', operations);
const sameRepair = startSaveCatalogRepairTask('full-validation', operations);
assert.equal(firstRepair, sameRepair, '同一标签页必须复用正在运行的恢复任务。');
await firstStartedPromise;

let releaseWrite;
const writeGate = new Promise((resolve) => {
  releaseWrite = resolve;
});
const writeTask = runWithSaveMutationPriority(() => writeGate);
releaseFirst();
await new Promise((resolve) => setTimeout(resolve, 20));
assert.deepEqual(repaired, [11], '待写操作存在时不得开始恢复下一节点。');
releaseWrite();
await writeTask;
await firstRepair;
assert.deepEqual(repaired, [11, 12], '写操作完成后必须继续剩余恢复节点。');

let releaseFirstMutation;
let markFirstMutationStarted;
const firstMutationStarted = new Promise((resolve) => {
  markFirstMutationStarted = resolve;
});
const firstMutationGate = new Promise((resolve) => {
  releaseFirstMutation = resolve;
});
const mutationOrder = [];
const firstMutation = runWithSaveMutationPriority(async () => {
  mutationOrder.push('first:start');
  markFirstMutationStarted();
  await firstMutationGate;
  mutationOrder.push('first:end');
});
await firstMutationStarted;
const secondMutation = runWithSaveMutationPriority(async () => {
  mutationOrder.push('second:start');
  mutationOrder.push('second:end');
});
await new Promise((resolve) => setTimeout(resolve, 20));
assert.deepEqual(
  mutationOrder,
  ['first:start'],
  '同一运行时内的第二个存档写操作必须等待第一个写操作结束。',
);
releaseFirstMutation();
await Promise.all([firstMutation, secondMutation]);
assert.deepEqual(
  mutationOrder,
  ['first:start', 'first:end', 'second:start', 'second:end'],
  '存档写操作必须按进入顺序串行执行。',
);

console.log('[save-catalog-behavior-regression] ok');
