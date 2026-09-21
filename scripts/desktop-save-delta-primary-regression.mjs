import fs from 'node:fs';

/**
 * C2（桌面存档 delta-primary）的接线门禁。
 *
 * 这不是"名字存在性"断言，而是三条**承重契约**：
 * 1) delta 必须先于存档记录写入 —— 否则崩溃窗口会留下"没有 delta 的占位档"，读不回来；
 * 2) 桌面读回的存档必须经过 `restoreDeltaSaveIfNeeded` —— 占位档只有靠它才能还原；
 * 3) 镜像侧必须保留"基线不是完整档就回退整档"的守卫 —— 保证 delta 链深度恒为 1。
 */

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dbService = fs.readFileSync('services/dbService.ts', 'utf8');
const mirror = fs.readFileSync('services/desktop/desktopSaveMirror.ts', 'utf8');

// 1) 写入顺序
const writeBlock = dbService.slice(
  dbService.indexOf('async function writeDesktopPrimarySaveBeforeIndexedDbSafely'),
  dbService.indexOf('async function reserveDesktopSaveIdSafely'),
);
assert(writeBlock.length > 0, '找不到桌面主写函数。');
const deltaWriteIndex = writeBlock.indexOf('await mirrorSaveNodeDeltaToDesktop(delta)');
const saveWriteIndex = writeBlock.indexOf('await mirrorSaveToDesktop(save, buildSaveSummary(save), {');
assert(deltaWriteIndex !== -1 && saveWriteIndex !== -1, '桌面主写必须同时写 delta 与存档记录。');
assert(
  deltaWriteIndex < saveWriteIndex,
  'delta 必须先于存档记录写入：反序会在两步之间崩溃时留下无法还原的占位档。',
);
assert(writeBlock.includes('deltaPrimaryBaseSaveId: delta?.deltaPayload?.baseSaveId'), '存档记录必须把增量基线告知镜像。');

// 2) 读回重建
assert(
  dbService.includes('await restoreDeltaSaveIfNeeded(db, save)'),
  '桌面读回的存档必须经过 restoreDeltaSaveIfNeeded，否则占位档会以"空档"形态被加载。',
);

// 3) 镜像守卫
assert(
  mirror.includes("item.storageMode !== 'delta'"),
  '镜像必须校验「基线是完整档」才允许写占位档，否则会形成读不回的 delta 链。',
);
assert(
  mirror.includes('storedSave ?? stripSaveAssetPayloadForStorage(save)'),
  '占位档构造失败时必须回退整档写入。',
);

console.log('desktop save delta primary regression ok');
