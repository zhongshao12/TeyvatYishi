import type { 存档数据, 存档类型 } from '@/models/settings';
import { normalizeTeyvatGameState, type TeyvatSaveData } from '@/models/teyvat';
import { classifySaveUniverse, migratePartialTeyvatSave } from '@/compat/legacy-hsr/migrate';
import { buildSavePackage, buildSaveTreePackage, parseSavePackageByUniverse, parseSaveTreePackage } from '@/services/savePackage';
import { normalizeSaveType, sanitizeSaveFilename } from '@/services/storage/saveRecordFormat';

type StoredTeyvatSave = TeyvatSaveData & {
  id?: number;
  type?: 存档类型;
  timestamp?: number;
  saveTree?: import('@/utils/saveTree').存档树元信息;
};

type SaveWithTree = 存档数据 & {
  saveTree?: import('@/utils/saveTree').存档树元信息;
};

function normalizeStoredTeyvatSave(value: unknown): StoredTeyvatSave {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const normalized = normalizeTeyvatGameState(raw);
  return {
    ...normalized,
    ...(Number.isFinite(Number(raw.id)) ? { id: Number(raw.id) } : {}),
    ...(typeof raw.type === 'string' ? { type: normalizeSaveType(raw.type) } : {}),
    ...(Number.isFinite(Number(raw.timestamp)) ? { timestamp: Number(raw.timestamp) } : {}),
    ...(raw.saveTree && typeof raw.saveTree === 'object'
      ? { saveTree: raw.saveTree as import('@/utils/saveTree').存档树元信息 }
      : {}),
  };
}

function requireTeyvatStoredSave(value: unknown): StoredTeyvatSave {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (raw.universe !== 'teyvat' || raw.schemaVersion !== 2) throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
  return normalizeStoredTeyvatSave(raw);
}

function migrateImportCandidate(value: unknown, label: string): 存档数据 {
  const classification = classifySaveUniverse(value);
  if (classification === 'teyvat') return normalizeStoredTeyvatSave(value) as unknown as 存档数据;
  if (classification === 'legacy-hsr') throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
  if (classification === 'partial-teyvat') {
    const migration = migratePartialTeyvatSave(value, {});
    if (migration.status === 'migrated') {
      return normalizeStoredTeyvatSave({ ...(value as Record<string, unknown>), ...migration.state }) as unknown as 存档数据;
    }
    if (migration.status === 'needs-input') throw new Error(`${label}迁移需要在游戏存档页确认字段映射`);
  }
  throw new Error(`无效的${label}`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportStamp(timestamp?: number): string {
  return new Date(timestamp || Date.now()).toISOString().replace(/[:.]/gu, '-');
}

export async function exportSaveJson(save: 存档数据): Promise<void> {
  const formal = requireTeyvatStoredSave(save);
  const json = JSON.stringify(normalizeTeyvatGameState(formal), null, 2);
  const travelerName = sanitizeSaveFilename(formal.旅行者.姓名 || 'traveler');
  downloadBlob(
    new Blob([json], { type: 'application/json' }),
    `KaiTuoYiShi-${travelerName}-turn-${formal.turnCount}-${exportStamp(formal.timestamp)}.json`,
  );
}

export async function exportSavePackage(save: 存档数据): Promise<void> {
  const formal = requireTeyvatStoredSave(save);
  const blob = await buildSavePackage(formal);
  const travelerName = sanitizeSaveFilename(formal.旅行者.姓名 || 'traveler');
  downloadBlob(blob, `KaiTuoYiShi-${travelerName}-turn-${formal.turnCount}-${exportStamp(formal.timestamp)}.zip`);
}

export async function exportSaveTreePackage(saves: 存档数据[]): Promise<void> {
  const formalSaves = saves.map(requireTeyvatStoredSave);
  const blob = await buildSaveTreePackage(formalSaves);
  const latest = [...formalSaves].sort((left, right) => (Number(right.timestamp) || 0) - (Number(left.timestamp) || 0))[0];
  const travelerName = sanitizeSaveFilename(latest?.旅行者.姓名 || 'traveler');
  downloadBlob(blob, `KaiTuoYiShi-${travelerName}-tree-${saves.length}-nodes-turn-${latest?.turnCount ?? 0}-${exportStamp(latest?.timestamp)}.zip`);
}

export function importSaveJson(json: string): 存档数据 {
  return migrateImportCandidate(JSON.parse(json), '存档文件');
}

export async function importSaveFile(file: File): Promise<存档数据> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json') || file.type === 'application/json') return importSaveJson(await file.text());
  if (name.endsWith('.ktysave') || name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
    const parsed = await parseSavePackageByUniverse(await file.arrayBuffer());
    if (parsed.kind === 'teyvat') return parsed.save as unknown as 存档数据;
    if (parsed.kind === 'partial-teyvat') return migrateImportCandidate(parsed.raw, '存档包');
    if (parsed.kind === 'legacy-hsr') throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
    throw new Error(parsed.errors.join('；') || '无效的存档包');
  }
  throw new Error('不支持的存档格式，请选择 .zip、.ktysave 或旧版 .json');
}

export async function importSaveFileAsMany(file: File): Promise<存档数据[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json') || file.type === 'application/json') return [importSaveJson(await file.text())];
  if (name.endsWith('.ktysave') || name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
    const saves = (await parseSaveTreePackage(await file.arrayBuffer())).map((save) => migrateImportCandidate(save, '存档包'));
    return remapImportedSaveTree(saves);
  }
  throw new Error('不支持的存档格式，请选择 .zip、.ktysave 或旧版 .json');
}

function remapImportedSaveTree(saves: 存档数据[]): 存档数据[] {
  if (saves.length <= 1) return saves;
  const rootId = createImportId('save_root_import');
  const nodeIdMap = new Map<string, string>();
  for (const save of saves) {
    const tree = (save as SaveWithTree).saveTree;
    if (tree?.nodeId) nodeIdMap.set(tree.nodeId, createImportId('save_node_import'));
  }
  return saves.map((save, index) => {
    const tree = (save as SaveWithTree).saveTree;
    if (!tree?.nodeId) {
      return {
        ...save,
        saveTree: { rootId, nodeId: createImportId('save_node_import'), branchName: '导入节点', createdAt: save.timestamp || Date.now() + index },
      } as 存档数据;
    }
    return {
      ...save,
      saveTree: {
        ...tree,
        rootId,
        nodeId: nodeIdMap.get(tree.nodeId) ?? createImportId('save_node_import'),
        parentNodeId: tree.parentNodeId ? nodeIdMap.get(tree.parentNodeId) : undefined,
        branchName: tree.branchName ?? '导入节点',
        createdAt: tree.createdAt || save.timestamp || Date.now() + index,
      },
    } as 存档数据;
  });
}

function createImportId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
