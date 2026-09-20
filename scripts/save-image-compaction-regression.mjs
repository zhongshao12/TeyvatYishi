import fs from 'node:fs';
import { readWorkflowSources } from './lib/workflowSources.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const compactor = fs.readFileSync('utils/saveImageCompactor.ts', 'utf8');
const saveLoad = fs.readFileSync('hooks/useGame/saveLoadWorkflow.ts', 'utf8');
const savePackage = fs.readFileSync('services/savePackage.ts', 'utf8');
// 正文生图工作流已抽到 hooks/useGame/narrativeImageWorkflow.ts；按「主剧情工作流」整体读取。
// 迁移: 读取源由手工数组收敛为 scripts/lib/workflowSources.mjs 登记的工作流视图
//       （sendWorkflow / narrativeImageWorkflow 均已登记），后续搬迁不必再改本脚本数组。
const sendWorkflow = readWorkflowSources();
const runtimeCompactor = fs.readFileSync('utils/saveRuntimeCompactor.ts', 'utf8');
const turnItem = fs.readFileSync('components/features/Chat/TurnItem.tsx', 'utf8');
const courierModal = fs.readFileSync('components/features/Courier/CourierModal.tsx', 'utf8');
const albumActions = fs.readFileSync('utils/albumActions.ts', 'utf8');

assert(compactor.includes('export function compactDuplicatedSaveImages'), 'must export save image compactor.');
assert(compactor.includes('const { 相册: album, ...withoutAlbum } = save'), 'compactor must keep album asset source data out of the replacement clone.');
assert(compactor.includes('new WeakMap()'), 'compactor must use a single-pass WeakMap clone.');
assert(compactor.includes('refs.get(value) ?? value'), 'compactor must replace only data URLs already stored in album assets.');
assert(!runtimeCompactor.includes('structuredClone'), 'runtime snapshot compaction must not duplicate the already-compacted graph.');
assert(albumActions.includes('export function 创建相册资源引用'), 'album actions must provide asset reference creation.');
assert(albumActions.includes('export function 解析相册资源引用'), 'album actions must resolve asset references for display.');
assert(sendWorkflow.includes('dataUrl: 创建相册资源引用(item.asset.id)'), 'narrative images stored on chat messages must use album asset refs after archive.');
assert(saveLoad.includes('return compactDuplicatedSaveImages(withTree)'), 'normal save payload must compact duplicated image data after attaching save tree metadata.');
assert(savePackage.includes('compactDuplicatedSaveImages(save as unknown as 存档数据)'), 'exported Teyvat save packages must compact duplicated image data.');
assert(turnItem.includes('解析相册资源引用(album, image.dataUrl)'), 'chat narrative image display must resolve album asset refs.');
// 迁移: 旧 `解析相册资源引用(album, courier.wallpapers.home)` / `解析相册资源引用(album, fromMessage)`
//   -> 新 `resolveAlbumValue(courier.wallpapers.home)` / `resolveAlbumValue(fromMessage)`；
// 理由: CourierModal 把相册引用解析收成带缓存的局部助手 resolveAlbumValue，其内部仍调用
//   `解析相册资源引用(album, value)`。意图不变——手机背景与消息头像仍必须先解析相册资源引用才能当作图片 URL 使用。
const courierResolvesAlbumRefs = courierModal.includes('const resolved = 解析相册资源引用(album, value) || undefined;');
assert(courierResolvesAlbumRefs && courierModal.includes('resolveAlbumValue(courier.wallpapers.home) ?? courier.wallpapers.home'), 'Courier backgrounds must resolve album asset refs.');
assert(courierModal.includes('message.avatar?.trim()') && courierModal.includes('return resolveAlbumValue(fromMessage);'), 'Courier message avatars must resolve album asset refs.');

console.log('save image compaction regression ok');
