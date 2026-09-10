import fs from 'node:fs/promises';
import path from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const app = await fs.readFile(path.join(root, 'App.tsx'), 'utf8');
const chat = await fs.readFile(path.join(root, 'components/features/Chat/ChatList.tsx'), 'utf8');
const album = await fs.readFile(path.join(root, 'components/features/GameSystems/AlbumPanel.tsx'), 'utf8');
const albumActions = await fs.readFile(path.join(root, 'utils/albumActions.ts'), 'utf8');
const saveModal = await fs.readFile(path.join(root, 'components/features/SaveLoad/SaveLoadModal.tsx'), 'utf8');
const storage = await fs.readFile(path.join(root, 'components/features/Settings/StorageManager.tsx'), 'utf8');
const compactor = await fs.readFile(path.join(root, 'utils/saveRuntimeCompactor.ts'), 'utf8');
const catalogRepair = await fs.readFile(path.join(root, 'services/storage/saveCatalogRepair.ts'), 'utf8');

assert(app.includes('lazyWithRetry('), '重型面板必须使用 lazyWithRetry');
assert(chat.includes('const INITIAL_RENDER_TURNS = 20;') && chat.includes('const [renderTurnLimit, setRenderTurnLimit] = useState(INITIAL_RENDER_TURNS);'), '聊天列表必须按回合限制初始渲染数量');
assert(chat.includes('const historyWasReplaced = previousHistoryIdentity.length > 0'), '聊天列表必须识别存档或历史被替换');
assert(chat.includes('const effectiveRenderTurnLimit = historyWasReplaced ? INITIAL_RENDER_TURNS : renderTurnLimit;'), '切换存档时必须立即恢复近期回合渲染上限');
assert(chat.includes('findHistoryWindowStart(visibleMessages, effectiveRenderTurnLimit)') && chat.includes('visibleMessages.slice(renderedStartIndex)'), '聊天列表必须只渲染近期回合窗口');
assert(albumActions.includes('MAX_IMAGE_IMPORT_BYTES = 12 * 1024 * 1024'), '图片导入必须限制单文件大小');
assert(album.includes("const file = Array.from(files).find((item) => item.type.startsWith('image/'));"), '参考图替换必须选择首张有效图片');
assert(album.includes("setMessage('导入失败：图片未能读取或超过 12MB。');"), '参考图读取失败必须报告不可读或超限');
for (const source of [saveModal, storage]) {
  assert(source.includes('startSaveCatalogRepair') && source.includes('subscribeSaveCatalogRepair'), '存档界面必须复用后台目录修复任务');
}
assert(catalogRepair.includes('await delay(0);'), '后台目录修复必须在每个条目后主动让出主线程');
assert(compactor.includes('const compacted = compactDataImages({'), '回滚快照必须先递归移除图片和大型运行数据');
assert(compactor.includes('return compacted;'), '回滚快照必须直接返回压缩过程创建的新对象，避免二次深拷贝');
assert(!compactor.includes('structuredClone(snapshot)'), '回滚快照不得直接深拷贝含图片的原始状态');

console.log('crash memory regression ok');
