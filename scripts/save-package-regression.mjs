import fs from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// 迁移: 旧 `dbService = readFileSync('services/dbService.ts')`（存档包导入导出实现本体当时就在该文件里）
//   -> 新 `dbService = dbService.ts + services/storage/saveImportExportService.ts`；
// 理由: 实现已抽到 services/storage/saveImportExportService.ts，dbService.ts 只保留 re-export；
// 断言保护的是「dbService 边界对外提供的存档包能力」，不是文件位置，所以按「dbService 边界」整体读取。
const dbService = [
  fs.readFileSync('services/dbService.ts', 'utf8'),
  fs.readFileSync('services/storage/saveImportExportService.ts', 'utf8'),
].join('\n');
// 存档导入导出实现已抽到 services/storage/saveImportExportService.ts；按「存档包」整体读取。
const savePackage = [
  fs.readFileSync('services/savePackage.ts', 'utf8'),
  fs.readFileSync('services/storage/saveImportExportService.ts', 'utf8'),
].join('\n');
const teyvatSaveContract = fs.readFileSync('models/teyvat/save.ts', 'utf8');
const saveLoadWorkflow = fs.readFileSync('hooks/useGame/saveLoadWorkflow.ts', 'utf8');
const saveModal = fs.readFileSync('components/features/SaveLoad/SaveLoadModal.tsx', 'utf8');
// StorageManager 的桌面存储状态与存档树视图已拆到 components/features/Settings/storage/；按「存储设置 UI」整体读取。
const storageManager = [
  fs.readFileSync('components/features/Settings/StorageManager.tsx', 'utf8'),
  fs.readFileSync('components/features/Settings/storage/DesktopStorageStatus.tsx', 'utf8'),
  fs.readFileSync('components/features/Settings/storage/StorageSaveTreeView.tsx', 'utf8'),
].join('\n');

assert(savePackage.includes("app: 'KaiTuoYiShi'"), '存档包 manifest 必须标记应用名。');
assert(teyvatSaveContract.includes("universe: 'teyvat'"), 'Teyvat manifest 必须标记 universe。');
assert(teyvatSaveContract.includes('schemaVersion: 2'), 'Teyvat manifest 必须标记 schemaVersion=2。');
assert(!savePackage.includes("universe: 'legacy-hsr'"), '正式写入边界不得生成 legacy manifest。');
assert(savePackage.includes("throw new Error('LEGACY_HSR_SAVE_READ_ONLY')"), '旧宇宙存档必须保持只读。');
assert(savePackage.includes('export async function parseSavePackageByUniverse'), '必须提供按宇宙分类的存档包解析入口。');
assert(savePackage.includes('validateExplicitPackageUniverse'), '显式 universe/schemaVersion 必须在包解析边界校验。');
assert(dbService.includes('resolveCatalogUniverseVersionForWrite'), 'dbService 必须在目录写入边界解析并传播 universe/schemaVersion。');
assert(dbService.includes('...resolveCatalogUniverseVersionForWrite(save)'), '存档摘要与隐藏节点必须从源存档传播 universe/schemaVersion。');
assert(dbService.includes('resolveCatalogUniverseVersionForWrite(versionSource ?? getRequest.result)'), '不可读目录记录必须从源存档或现有记录传播，并只在 dbService 兼容边界显式标记 legacy。');
assert(savePackage.includes("kind: 'save-package'"), '存档包 manifest 必须标记类型。');
assert(savePackage.includes("kind: 'save-package'") && savePackage.includes("kind: 'save-tree-package'"), '存档包 manifest 必须支持单节点与整棵存档树包类型。');
assert(savePackage.includes('manifest.json'), '存档包必须包含 manifest.json。');
assert(savePackage.includes('save.json'), '存档包必须包含 save.json。');
assert(savePackage.includes("const TREE_MANIFEST_PATH = 'tree/tree-manifest.json'"), '整树导出必须包含 tree-manifest。');
assert(savePackage.includes("const TREE_NODE_DIR = 'tree/nodes'"), '整树导出必须把节点写入 tree/nodes。');
assert(savePackage.includes('export async function buildSaveTreePackage'), '必须提供异步整棵存档树打包函数。');
assert(savePackage.includes('export async function parseSaveTreePackage'), '必须提供整棵存档树解析函数。');
assert(savePackage.includes("kind: 'save-tree-package'"), '整树包 manifest 必须写入 save-tree-package 类型。');
assert(savePackage.includes('parseSaveTreePackageFiles'), '树包解析必须读取 tree-manifest 和节点文件。');
assert(savePackage.includes("manifest.kind === 'save-tree-package'"), '单存档解析入口必须兼容树包并返回最新节点。');
assert(savePackage.includes("files: ['manifest.json', 'save.json']"), '单包必须携带一个完整、原子的正式 Teyvat 根。');
assert(savePackage.includes('sanitizeTeyvatSaveForExport'), '正式根导出前必须归一化并清理运行时数据。');
assert(savePackage.includes('createZip') && savePackage.includes('readZip'), '必须提供 ZIP 打包和读取能力。');
assert(savePackage.includes('crc32'), 'ZIP 条目必须带 CRC 校验。');
assert(savePackage.includes('CompressionStream') && savePackage.includes('DecompressionStream'), 'ZIP 打包必须优先使用浏览器原生 deflate 压缩并支持解压。');
assert(savePackage.includes('deflateRawIfAvailable'), 'ZIP 写入必须在不支持压缩时自动回退 store 方法。');
assert(savePackage.includes('compression !== 0 && compression !== 8'), 'ZIP 读取必须同时兼容 store 和 deflate 方法。');
assert(savePackage.includes('当前浏览器不支持压缩存档包解压'), '压缩包读取失败时必须给出浏览器兼容提示。');
assert(savePackage.includes('validatePackageManifest'), '导入存档包必须校验 manifest。');
assert(savePackage.includes('存档包版本过高，请更新客户端后再导入'), '导入存档包必须拒绝高版本包。');
assert(savePackage.includes('存档包清单包含非法路径'), '导入存档包必须拒绝非法路径。');
assert(savePackage.includes('存档包缺少清单文件'), '导入存档包必须校验清单文件存在。');
assert(savePackage.includes('PACKAGE_CORE_FILES'), '导入存档包必须校验核心文件。');
assert(savePackage.includes("manifest.kind === 'save-tree-package' ? ['manifest.json', TREE_MANIFEST_PATH] : PACKAGE_CORE_FILES"), '树包和单包必须分别校验核心文件。');
assert(savePackage.includes('const normalized = normalizeTeyvatGameState(source)'), '存档包导出必须通过 schema-2 白名单归一化，清除未知根和调试 sidecar。');
assert(!savePackage.includes('SYSTEM_ENTRY_PATHS'), '正式包不得重新拆回旧系统 sidecar 文件。');
assert(saveLoadWorkflow.includes('compactChatHistoryForLongSession'), '本地持久化存档必须复用长期会话聊天归一化。');
assert(saveLoadWorkflow.includes('compactVariableBatchHistory'), '本地持久化存档必须复用变量批次归一化。');
assert(!saveLoadWorkflow.includes('delete clean.preTurnSnapshot'), '本地持久化存档不得移除 chatHistory.preTurnSnapshot，否则读档后立即重roll无法完整回滚。');
assert(savePackage.includes('apiKeysRemoved: true'), '存档包 manifest 必须声明 API Key 已移除。');
assert(savePackage.includes('assertTeyvatSaveForWrite(save)'), '每个导出入口都必须先执行正式写入边界。');

assert(dbService.includes('exportSavePackage'), 'dbService 必须导出新存档包导出函数。');
assert(dbService.includes('export async function exportSavePackage'), '存档包导出必须是异步函数以等待压缩完成。');
assert(dbService.includes('exportSaveTreePackage'), 'dbService 必须导出整棵存档树包导出函数。');
assert(dbService.includes('export async function exportSaveTreePackage'), '整树包导出必须是异步函数以等待压缩完成。');
assert(dbService.includes('loadSaveTree'), 'dbService 必须能按 rootId 收集整棵存档树。');
assert(dbService.includes('importSaveFile'), 'dbService 必须导出统一导入函数。');
assert(dbService.includes('importSaveFileAsMany'), 'dbService 必须导出可导入多节点树包的入口。');
assert(dbService.includes('importSaveJson(await file.text())'), '统一导入函数必须保留旧 JSON 兼容。');
assert(dbService.includes('parseSavePackageByUniverse(await file.arrayBuffer())'), '统一导入函数必须按 universe 边界分类存档包。');
assert(dbService.includes('parseSaveTreePackage(await file.arrayBuffer())'), '多节点导入入口必须使用树包解析。');
assert(dbService.includes('remapImportedSaveTree'), '导入树包必须重映射 rootId/nodeId，避免和本地已有树冲突。');
assert(dbService.includes('nodeIdMap') && dbService.includes('parentNodeId: tree.parentNodeId ? nodeIdMap.get(tree.parentNodeId) : undefined'), '导入树包必须同步重映射父子节点关系。');
assert(
  dbService.includes('normalizeTeyvatGameState(formal)'),
  'JSON 导出入口也必须复用正式 Teyvat 根归一化。',
);
assert(dbService.includes('`.zip`') || dbService.includes('.zip`'), '导出文件后缀必须使用 .zip。');
assert(dbService.includes("name.endsWith('.ktysave')"), '导入函数必须保留旧 .ktysave 兼容。');

assert(saveModal.includes('exportSavePackage') && saveModal.includes('parseSavePackageByUniverse'), '游戏存档弹窗必须导出正式包并按 universe 边界解析导入。');
assert(saveModal.includes('exportSaveTreePackage') && saveModal.includes('loadSaveTree'), '游戏存档弹窗必须提供整树导出入口。');
assert(saveModal.includes('导出整树'), '游戏存档弹窗必须显示导出整树按钮。');
assert(saveModal.includes('.ktysave,.zip,.json'), '游戏存档弹窗必须同时接受新包和旧 JSON。');
assert(saveModal.includes('导入存档包'), '游戏存档弹窗 UI 文案必须更新为存档包。');

assert(storageManager.includes('exportSavePackage') && storageManager.includes('importSaveFileAsMany'), '设置页存档管理必须使用存档包导入导出。');
assert(storageManager.includes('exportSaveTreePackage') && storageManager.includes('loadSaveTree'), '设置页存档管理必须提供整树导出入口。');
assert(storageManager.includes('导出整树'), '设置页存档管理必须显示导出整树按钮。');
assert(storageManager.includes('.ktysave,.zip,.json'), '设置页存档管理必须同时接受新包和旧 JSON。');
assert(storageManager.includes('导入存档包'), '设置页存档管理 UI 文案必须更新为存档包。');
assert(storageManager.includes('导出存档包默认不包含 API Key'), '设置页存档管理必须提示导出包不会携带 API Key。');

console.log('save package regression ok');
