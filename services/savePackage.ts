import type { 存档数据 } from '@/models/settings';
import { classifySaveUniverse, migratePartialTeyvatSave } from '@/compat/legacy-hsr/migrate';
import { restoreLegacyPackageSystems } from '@/compat/legacy-hsr/readOnly';
import {
  normalizeTeyvatGameState,
  TEYVAT_SCHEMA_VERSION,
  type TeyvatSaveData,
} from '@/models/teyvat/state';
import type { ParsedSavePackage, TeyvatSaveManifest } from '@/models/teyvat/save';
import { compactDuplicatedSaveImages } from '@/utils/saveImageCompactor';
import { expandSaveAssetPayloadForExport } from '@/utils/saveAssetStorage';
import { readByteStreamWithLimit } from '@/services/cloudBackupPackage';
import {
  collectApiKeySecrets,
  findApiKeyFieldPaths,
  findLeakedSecrets,
  redactApiKeysDeep,
} from '@/services/storage/sensitiveSettings';
import { concatBytes, crc32 } from '@/utils/zip';

const PACKAGE_VERSION = 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PACKAGE_CORE_FILES = ['manifest.json', 'save.json'] as const;
const TREE_MANIFEST_PATH = 'tree/tree-manifest.json';
const TREE_NODE_DIR = 'tree/nodes';

interface SavePackageManifestInput {
  app?: unknown;
  kind?: unknown;
  packageVersion?: unknown;
  universe?: unknown;
  schemaVersion?: unknown;
  exportedAt?: unknown;
  travelerName?: unknown;
  turnCount?: unknown;
  timestamp?: unknown;
  format?: unknown;
  nodeCount?: number;
  rootId?: string;
  privacy?: { apiKeysRemoved?: boolean };
  files?: unknown;
}

export interface 存档树包清单 {
  rootId: string;
  exportedAt: string;
  nodeCount: number;
  latestSaveId: number;
  nodes: Array<{
    id: number;
    nodeId: string;
    parentNodeId?: string;
    branchName?: string;
    type: 存档数据['type'];
    timestamp: number;
    turnCount: number;
    path: string;
  }>;
}

type ZipEntryInput = {
  name: string;
  bytes: Uint8Array;
};

type ZipEntryOutput = ZipEntryInput & {
  compressedBytes: Uint8Array;
  compressionMethod: 0 | 8;
  crc32: number;
};

export async function buildSavePackage(save: 存档数据 | TeyvatSaveData): Promise<Blob> {
  assertTeyvatSaveForWrite(save);
  // 导出边界真实剥离：不再依赖 schema-2 白名单的副作用顺手丢字段。
  const secrets = collectApiKeySecrets(save);
  const expanded = await expandSaveAssetPayloadForExport(save as unknown as 存档数据);
  const portable = sanitizeTeyvatSaveForExport(expanded as unknown as TeyvatSaveData);
  const safePortable = redactApiKeysDeep(portable);
  const manifest: TeyvatSaveManifest = {
    app: 'KaiTuoYiShi',
    kind: 'save-package',
    format: 'ktysave',
    packageVersion: PACKAGE_VERSION,
    universe: 'teyvat',
    schemaVersion: TEYVAT_SCHEMA_VERSION,
    files: ['manifest.json', 'save.json'],
  };
  const entries = [
    textEntry('manifest.json', manifest),
    textEntry('save.json', safePortable),
  ];
  assertNoApiKeyFieldsInExport(entries);
  return new Blob([await createZip(entries)], { type: 'application/zip' });
}

export async function buildSaveTreePackage(saves: Array<存档数据 | TeyvatSaveData>): Promise<Blob> {
  const candidates = saves.filter((save) => save && typeof save === 'object');
  if (!candidates.length) throw new Error('没有可导出的存档树节点');
  for (const save of candidates) assertTeyvatSaveForWrite(save);
  const secrets = candidates.flatMap((save) => collectApiKeySecrets(save));
  const expandedSaves = await Promise.all(
    candidates.map((save) => expandSaveAssetPayloadForExport(save as unknown as 存档数据)),
  );
  const normalized = expandedSaves
    .map((save) => redactApiKeysDeep(sanitizeTeyvatSaveForExport(save as unknown as TeyvatSaveData)))
    .sort((a, b) => readSaveTimestamp(a) - readSaveTimestamp(b) || readSaveId(a) - readSaveId(b));
  // 说明：这里每个节点都已经过 sanitizeTeyvatSaveForExport 归一化 + redactApiKeysDeep 剥离，
  // 单包路径（buildSavePackage）保留 `const portable = sanitizeTeyvatSaveForExport` 的边界写法。
  const first = normalized[0];
  const latest = [...normalized].sort((a, b) => readSaveTimestamp(b) - readSaveTimestamp(a))[0];
  if (!first || !latest) throw new Error('没有可导出的有效存档树节点');
  const rootId = getSaveTreeRootId(first) || `tree-${Date.now()}`;
  const nodeEntries = normalized.map((save, index) => {
    const tree = getSaveTreeMetaLoose(save);
    const id = readSaveId(save) || index + 1;
    const nodeId = tree?.nodeId || `teyvat-node-${id}`;
    const path = `${TREE_NODE_DIR}/${sanitizePackageSegment(nodeId)}-${id}.json`;
    return {
      save,
      path,
      meta: {
        id,
        nodeId,
        parentNodeId: tree?.parentNodeId,
        branchName: tree?.branchName,
        type: readSaveType(save),
        timestamp: readSaveTimestamp(save) || Date.now(),
        turnCount: save.turnCount,
        path,
      },
    };
  });
  const treeManifest: 存档树包清单 = {
    rootId,
    exportedAt: new Date().toISOString(),
    nodeCount: nodeEntries.length,
    latestSaveId: readSaveId(latest) || nodeEntries.at(-1)?.meta.id || 0,
    nodes: nodeEntries.map((entry) => entry.meta),
  };
  const files: Array<[string, unknown]> = [
    [TREE_MANIFEST_PATH, treeManifest],
    ...nodeEntries.map((entry) => [entry.path, entry.save] as [string, unknown]),
  ];
  const dataEntries = files.map(([name, value]) => textEntry(name, value));
  assertNoApiKeyFieldsInExport(dataEntries);
  const manifest: TeyvatSaveManifest & Record<string, unknown> = {
    app: 'KaiTuoYiShi',
    kind: 'save-tree-package',
    packageVersion: PACKAGE_VERSION,
    universe: 'teyvat',
    schemaVersion: TEYVAT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    travelerName: latest.旅行者.姓名 || 'traveler',
    turnCount: latest.turnCount,
    timestamp: readSaveTimestamp(latest) || Date.now(),
    format: 'ktysave',
    nodeCount: nodeEntries.length,
    rootId,
    // 真实检测结果，不是无条件声明：扫描将要写入 ZIP 的原始文本，
    // 只要还能找到输入里携带的任一供应商 Key 就如实声明 false。
    privacy: {
      apiKeysRemoved: findLeakedSecrets(readEntryTexts(dataEntries), secrets).length === 0,
    },
    files: ['manifest.json', ...files.map(([name]) => name)],
  };
  let manifestEntry = textEntry('manifest.json', manifest);
  // manifest 自身也要复核：travelerName 等字段取自存档，同样可能夹带 Key。
  assertNoApiKeyFieldsInExport([manifestEntry]);
  if (findLeakedSecrets([decoder.decode(manifestEntry.bytes)], secrets).length > 0) {
    manifest.privacy = { apiKeysRemoved: false };
    manifestEntry = textEntry('manifest.json', manifest);
  }
  const entries = [manifestEntry, ...dataEntries];
  return new Blob([await createZip(entries)], { type: 'application/zip' });
}

export async function parseSavePackage(buffer: ArrayBuffer): Promise<存档数据> {
  const files = await readZip(buffer);
  const manifestText = files.get('manifest.json');
  if (!manifestText) {
    throw new Error('存档包缺少 manifest.json');
  }
  const manifest = JSON.parse(manifestText) as SavePackageManifestInput;
  validatePackageManifest(manifest, files);
  if (manifest.kind === 'save-tree-package') {
    const tree = parseSaveTreePackageFiles(files, manifest);
    const latest = tree.nodes.find((save) => Number(save.id) === tree.latestSaveId) ?? tree.nodes.at(-1);
    if (!latest) throw new Error('存档树包没有可导入节点');
    return latest;
  }
  const saveText = files.get('save.json');
  if (!saveText) {
    throw new Error('存档包缺少 save.json');
  }
  const save = JSON.parse(saveText) as 存档数据;
  const read = <T,>(path: string): T | undefined => {
    const text = files.get(path);
    return text ? JSON.parse(text) as T : undefined;
  };
  return restoreLegacyPackageSystems(save as unknown as Record<string, unknown>, read) as unknown as 存档数据;
}

export async function parseSavePackageByUniverse(buffer: ArrayBuffer): Promise<ParsedSavePackage> {
  try {
    const files = await readZip(buffer);
    const manifestText = files.get('manifest.json');
    if (!manifestText) return { kind: 'invalid', errors: ['存档包缺少 manifest.json'] };
    const manifest = JSON.parse(manifestText) as SavePackageManifestInput & Record<string, unknown>;
    validatePackageManifest(manifest, files);
    const { raw, sourceBackupRaw, sourceJsonBytes } = readRawSavePackage(files, manifest);
    const rawClassification = classifySaveUniverse(raw);
    if (rawClassification === 'legacy-hsr') return { kind: 'legacy-hsr', raw };
    if (rawClassification === 'partial-teyvat') {
      return { kind: 'partial-teyvat', raw, sourceBackupRaw, sourceJsonBytes, migration: migratePartialTeyvatSave(raw, {}) };
    }
    const classification = typeof manifest.universe === 'string'
      ? classifySaveUniverse({ universe: manifest.universe })
      : rawClassification;
    if (classification !== 'teyvat') {
      return { kind: 'invalid', errors: ['无法识别存档宇宙'] };
    }
    const teyvatManifest = validateTeyvatManifest(manifest);
    return {
      kind: 'teyvat',
      manifest: teyvatManifest,
      save: normalizeTeyvatGameState(raw),
    };
  } catch (error) {
    return {
      kind: 'invalid',
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function parseSaveTreePackage(buffer: ArrayBuffer): Promise<存档数据[]> {
  const files = await readZip(buffer);
  const manifestText = files.get('manifest.json');
  if (!manifestText) {
    throw new Error('存档包缺少 manifest.json');
  }
  const manifest = JSON.parse(manifestText) as SavePackageManifestInput;
  validatePackageManifest(manifest, files);
  if (manifest.kind !== 'save-tree-package') {
    return [await parseSavePackage(buffer)];
  }
  return parseSaveTreePackageFiles(files, manifest).nodes;
}

function parseSaveTreePackageFiles(files: Map<string, string>, manifest: SavePackageManifestInput): { latestSaveId: number; nodes: 存档数据[] } {
  const treeManifestText = files.get(TREE_MANIFEST_PATH);
  if (!treeManifestText) {
    throw new Error('存档树包缺少 tree/tree-manifest.json');
  }
  const treeManifest = JSON.parse(treeManifestText) as Partial<存档树包清单>;
  if (!Array.isArray(treeManifest.nodes) || treeManifest.nodes.length === 0) {
    throw new Error('存档树包节点清单为空');
  }
  const nodes = treeManifest.nodes.map((node) => {
    if (!node?.path || !isSafePackagePath(node.path)) {
      throw new Error('存档树包节点路径异常');
    }
    const text = files.get(node.path);
    if (!text) {
      throw new Error(`存档树包缺少节点文件：${node.path}`);
    }
    return JSON.parse(text) as 存档数据;
  });
  return {
    latestSaveId: Number(treeManifest.latestSaveId) || Number(manifest.timestamp) || 0,
    nodes,
  };
}

function readRawSavePackage(
  files: Map<string, string>,
  manifest: SavePackageManifestInput,
): { raw: unknown; sourceBackupRaw: unknown; sourceJsonBytes: string } {
  if (manifest.kind === 'save-tree-package') {
    const treeManifestText = files.get(TREE_MANIFEST_PATH);
    if (!treeManifestText) throw new Error('存档树包缺少 tree/tree-manifest.json');
    const treeManifest = JSON.parse(treeManifestText) as Partial<存档树包清单>;
    if (!Array.isArray(treeManifest.nodes) || treeManifest.nodes.length === 0) {
      throw new Error('存档树包节点清单为空');
    }
    const selected = treeManifest.nodes.find((node) => Number(node.id) === Number(treeManifest.latestSaveId))
      ?? treeManifest.nodes.at(-1);
    if (!selected?.path || !isSafePackagePath(selected.path)) throw new Error('存档树包节点路径异常');
    const sourceJsonBytes = files.get(selected.path);
    if (!sourceJsonBytes) throw new Error(`存档树包缺少节点文件：${selected.path}`);
    const raw = JSON.parse(sourceJsonBytes);
    return { raw, sourceBackupRaw: raw, sourceJsonBytes };
  }
  const saveText = files.get('save.json');
  if (!saveText) throw new Error('存档包缺少 save.json');
  const save = JSON.parse(saveText) as Record<string, unknown>;
  const read = (path: string): unknown => {
    const text = files.get(path);
    return text ? JSON.parse(text) : undefined;
  };
  return { raw: restoreLegacyPackageSystems(save, read), sourceBackupRaw: save, sourceJsonBytes: saveText };
}

function textEntry(name: string, value: unknown): ZipEntryInput {
  return {
    name,
    bytes: encoder.encode(JSON.stringify(value, null, 2)),
  };
}

/** 导出产物的原始文本：检测必须针对真正要写进 ZIP 的字节。 */
function readEntryTexts(entries: readonly ZipEntryInput[]): string[] {
  return entries.map((entry) => decoder.decode(entry.bytes));
}

/**
 * 结构性复核：产物的 JSON 树里不得再出现任何仍然带值的 apiKey 字段。
 * 这一条如果不成立，说明剥离逻辑本身漏了路径，必须中止导出。
 */
function assertNoApiKeyFieldsInExport(entries: readonly ZipEntryInput[]): void {
  const leakedFieldPaths = readEntryTexts(entries).flatMap((text) => findApiKeyFieldPaths(safeJsonParse(text)));
  if (leakedFieldPaths.length > 0) {
    throw new Error(`存档包导出检测到 API Key 残留，已中止导出：${leakedFieldPaths.join('、')}`);
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function validatePackageManifest(manifest: SavePackageManifestInput, files: Map<string, string>): void {
  if (manifest.app !== 'KaiTuoYiShi' || (manifest.kind !== 'save-package' && manifest.kind !== 'save-tree-package')) {
    throw new Error('不是有效的旅行者纪事存档包');
  }
  if (manifest.format !== 'ktysave') {
    throw new Error('存档包格式标记异常');
  }
  const packageVersion = Number(manifest.packageVersion);
  if (!Number.isInteger(packageVersion) || packageVersion < 1) {
    throw new Error('存档包版本异常');
  }
  if (packageVersion > PACKAGE_VERSION) {
    throw new Error('存档包版本过高，请更新客户端后再导入');
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('存档包清单缺少文件列表');
  }
  validateExplicitPackageUniverse(manifest as Record<string, unknown>);

  for (const path of manifest.files) {
    if (!isSafePackagePath(path)) {
      throw new Error(`存档包清单包含非法路径：${String(path)}`);
    }
    if (!files.has(path)) {
      throw new Error(`存档包缺少清单文件：${path}`);
    }
  }

  const coreFiles = manifest.kind === 'save-tree-package' ? ['manifest.json', TREE_MANIFEST_PATH] : PACKAGE_CORE_FILES;
  for (const path of coreFiles) {
    if (!manifest.files.includes(path) || !files.has(path)) {
      throw new Error(`存档包缺少核心文件：${path}`);
    }
  }
}

function validateExplicitPackageUniverse(manifest: Record<string, unknown>): void {
  const hasUniverse = manifest.universe !== undefined;
  const hasSchemaVersion = manifest.schemaVersion !== undefined;
  if (!hasUniverse && !hasSchemaVersion) return;
  if (!hasUniverse || !hasSchemaVersion) {
    throw new Error('存档包的 universe/schemaVersion 标记不完整');
  }
  const isTeyvat = manifest.universe === 'teyvat' && manifest.schemaVersion === TEYVAT_SCHEMA_VERSION;
  const isLegacy = (manifest.universe === 'legacy-hsr' || manifest.universe === 'hsr') && manifest.schemaVersion === 1;
  if (!isTeyvat && !isLegacy) throw new Error('存档包的 universe/schemaVersion 组合不受支持');
}

function validateTeyvatManifest(manifest: Record<string, unknown>): TeyvatSaveManifest {
  if (manifest.universe !== 'teyvat') throw new Error('Teyvat 存档包缺少 universe 标记');
  if (manifest.schemaVersion !== TEYVAT_SCHEMA_VERSION) throw new Error('不兼容的 Teyvat 存档 schemaVersion');
  return {
    app: 'KaiTuoYiShi',
    kind: manifest.kind as TeyvatSaveManifest['kind'],
    format: 'ktysave',
    packageVersion: Number(manifest.packageVersion),
    universe: 'teyvat',
    schemaVersion: TEYVAT_SCHEMA_VERSION,
    files: [...(manifest.files as string[])],
  };
}

function isTeyvatSaveData(save: 存档数据 | TeyvatSaveData): save is TeyvatSaveData {
  return save?.universe === 'teyvat' && save.schemaVersion === TEYVAT_SCHEMA_VERSION;
}

function assertTeyvatSaveForWrite(save: 存档数据 | TeyvatSaveData): asserts save is TeyvatSaveData {
  if (isTeyvatSaveData(save)) return;
  if ((save as { universe?: unknown }).universe === 'teyvat') {
    throw new Error('不兼容的 Teyvat 存档 schemaVersion');
  }
  throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
}

type TeyvatStoredSave = TeyvatSaveData & {
  id?: number;
  type?: 存档数据['type'];
  timestamp?: number;
  saveTree?: { rootId?: string; nodeId?: string; parentNodeId?: string; branchName?: string };
};

export function sanitizeTeyvatSaveForExport(save: TeyvatSaveData): TeyvatStoredSave {
  assertTeyvatSaveForWrite(save);
  const source = compactDuplicatedSaveImages(save as unknown as 存档数据) as unknown as TeyvatStoredSave;
  const normalized = normalizeTeyvatGameState(source);
  return {
    ...normalized,
    ...(Number.isFinite(Number(source.id)) ? { id: Number(source.id) } : {}),
    ...(source.type ? { type: source.type } : {}),
    ...(Number.isFinite(Number(source.timestamp)) ? { timestamp: Number(source.timestamp) } : {}),
    ...(source.saveTree ? { saveTree: { ...source.saveTree } } : {}),
  };
}

const readSaveId = (save: TeyvatSaveData): number => Number((save as TeyvatStoredSave).id) || 0;
const readSaveTimestamp = (save: TeyvatSaveData): number => Number((save as TeyvatStoredSave).timestamp) || 0;
const readSaveType = (save: TeyvatSaveData): 存档数据['type'] => (save as TeyvatStoredSave).type ?? 'auto';

function isSafePackagePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.startsWith('\\') &&
    !path.includes('\\') &&
    !path.split('/').includes('..')
  );
}

async function createZip(inputEntries: ZipEntryInput[]): Promise<Uint8Array> {
  const entries: ZipEntryOutput[] = [];
  for (const entry of inputEntries) {
    const compressedBytes = await deflateRawIfAvailable(entry.bytes);
    entries.push({
      ...entry,
      compressedBytes: compressedBytes ?? entry.bytes,
      compressionMethod: compressedBytes ? 8 : 0,
      crc32: crc32(entry.bytes),
    });
  }
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const local = new Uint8Array(30 + nameBytes.length + entry.compressedBytes.length);
    const view = new DataView(local.buffer);
    writeLocalHeader(view, entry, nameBytes);
    local.set(nameBytes, 30);
    local.set(entry.compressedBytes, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    writeCentralHeader(new DataView(central.buffer), entry, nameBytes, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralOffset, true);

  return concatBytes([...localParts, ...centralParts, eocd]);
}

function getSaveTreeMetaLoose(save: 存档数据 | TeyvatSaveData): { rootId?: string; nodeId?: string; parentNodeId?: string; branchName?: string } | undefined {
  return (save as TeyvatStoredSave).saveTree;
}

function getSaveTreeRootId(save: 存档数据 | TeyvatSaveData): string | undefined {
  return getSaveTreeMetaLoose(save)?.rootId;
}

function sanitizePackageSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 80) || 'node';
}

function writeLocalHeader(view: DataView, entry: ZipEntryOutput, nameBytes: Uint8Array): void {
  const { time, date } = dosDateTime(new Date());
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entry.compressionMethod, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, entry.crc32, true);
  view.setUint32(18, entry.compressedBytes.length, true);
  view.setUint32(22, entry.bytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
}

function writeCentralHeader(view: DataView, entry: ZipEntryOutput, nameBytes: Uint8Array, offset: number): void {
  const { time, date } = dosDateTime(new Date());
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, entry.compressionMethod, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, entry.compressedBytes.length, true);
  view.setUint32(24, entry.bytes.length, true);
  view.setUint16(28, nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
}

async function readZip(buffer: ArrayBuffer): Promise<Map<string, string>> {
  return readSavePackageEntries(buffer);
}

export interface SavePackageReadLimits {
  /** 单个条目解压后的字节上限。 */
  maxEntryBytes?: number;
  /** 整包所有条目解压后的累计字节上限。 */
  maxTotalUnpackedBytes?: number;
}

/** 单个条目解压上限（与云备份分卷的条目上限同量级）。 */
export const SAVE_PACKAGE_ENTRY_LIMIT_BYTES = 256 * 1024 * 1024;
/** 整包解压累计上限（与相册备份的数据总量上限一致）。 */
export const SAVE_PACKAGE_UNPACKED_LIMIT_BYTES = 512 * 1024 * 1024;
export const SAVE_PACKAGE_LIMIT_MESSAGE = '存档包解压后大小超过安全上限。';

/**
 * 读取存档包 ZIP 条目。
 *
 * 解压必须是限额流式解压：小体积 DEFLATE 可以膨胀到几百 MB，
 * 只在解压完成后拿长度跟头部声明值比对等于没有上限。
 * 这里照抄 services/cloudBackupPackage.ts 的限额模式：
 * 先按头部声明值做 O(1) 预检，再用 readByteStreamWithLimit 累计拦截谎报大小的条目。
 */
export async function readSavePackageEntries(
  buffer: ArrayBuffer,
  limits: SavePackageReadLimits = {},
): Promise<Map<string, string>> {
  const maxEntryBytes = limits.maxEntryBytes ?? SAVE_PACKAGE_ENTRY_LIMIT_BYTES;
  const maxTotalUnpackedBytes = limits.maxTotalUnpackedBytes ?? SAVE_PACKAGE_UNPACKED_LIMIT_BYTES;
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const files = new Map<string, string>();
  let offset = 0;
  let declaredTotalBytes = 0;
  let unpackedTotalBytes = 0;
  while (offset + 30 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x02014b50 || signature === 0x06054b50) break;
    if (signature !== 0x04034b50) throw new Error('存档包 ZIP 结构损坏');
    const compression = view.getUint16(offset + 8, true);
    if (compression !== 0 && compression !== 8) throw new Error('暂不支持此 ZIP 压缩格式的存档包');
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error('存档包文件长度异常');
    if (fileSize > maxEntryBytes) throw new Error(SAVE_PACKAGE_LIMIT_MESSAGE);
    declaredTotalBytes += fileSize;
    if (declaredTotalBytes > maxTotalUnpackedBytes) throw new Error(SAVE_PACKAGE_LIMIT_MESSAGE);
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    const compressedData = bytes.slice(dataStart, dataEnd);
    const data = compression === 8
      ? await inflateRaw(compressedData, maxEntryBytes)
      : compressedData;
    unpackedTotalBytes += data.length;
    if (unpackedTotalBytes > maxTotalUnpackedBytes) throw new Error(SAVE_PACKAGE_LIMIT_MESSAGE);
    if (data.length !== fileSize) throw new Error('存档包条目大小异常');
    if (crc32(data) !== crc) throw new Error(`存档包条目校验失败：${name}`);
    files.set(name, decoder.decode(data));
    offset = dataEnd;
  }
  return files;
}

async function deflateRawIfAvailable(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (!('CompressionStream' in globalThis)) return null;
  try {
    return await runCompressionStream(bytes, 'deflate-raw');
  } catch {
    return null;
  }
}

async function inflateRaw(bytes: Uint8Array, maxOutputBytes: number): Promise<Uint8Array> {
  if (!('DecompressionStream' in globalThis)) {
    throw new Error('当前浏览器不支持压缩存档包解压，请更新浏览器或使用未压缩旧包');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  try {
    return await readByteStreamWithLimit(stream, maxOutputBytes);
  } catch (error) {
    // readByteStreamWithLimit 是云备份引入的共享限额读取器，这里把它的上限文案
    // 换成存档包语境（两者共用同一段中文后缀），其它错误原样抛出。
    if (error instanceof Error && error.message.includes('解压后大小超过安全上限')) {
      throw new Error(SAVE_PACKAGE_LIMIT_MESSAGE);
    }
    throw error;
  }
}

async function runCompressionStream(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}
