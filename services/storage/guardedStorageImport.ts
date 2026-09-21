export interface StorageImportRecord {
  id?: number;
  type?: string;
  timestamp?: number;
}

export interface GuardedStorageImportDependencies<T extends StorageImportRecord> {
  parse: (file: File) => Promise<T[]>;
  /**
   * 二次确认。允许异步：界面侧已统一用 `useConfirmDialog`（可换主题、有读屏标注、支持 danger 语气），
   * 它返回 Promise，而原生 `window.confirm` 是同步的 —— 两者都要被支持。
   */
  confirm: (message: string) => boolean | Promise<boolean>;
  backup: (file: File) => Promise<{ backupId: string }>;
  persist: (record: T) => Promise<unknown>;
  now?: () => number;
}

export type GuardedStorageImportResult =
  | { status: 'cancelled'; count: number }
  | { status: 'imported'; count: number; backupId: string };

/**
 * Shared safety boundary for Storage Manager imports.
 * Parsing and explicit consent happen before the exact source file is backed up;
 * no database write may begin unless that backup succeeds.
 */
export async function runGuardedStorageImport<T extends StorageImportRecord>(
  file: File,
  dependencies: GuardedStorageImportDependencies<T>,
): Promise<GuardedStorageImportResult> {
  const records = await dependencies.parse(file);
  if (records.length === 0) throw new Error('存档包中没有可导入的存档节点。');
  const confirmed = await dependencies.confirm(
    `准备导入 ${records.length} 个存档节点。导入只会新增节点，并会先下载所选源文件备份；是否继续？`,
  );
  if (!confirmed) return { status: 'cancelled', count: records.length };

  const backup = await dependencies.backup(file);
  const timestamp = (dependencies.now ?? Date.now)();
  for (const [index, source] of records.entries()) {
    const record = {
      ...source,
      id: 0,
      type: 'imported',
      timestamp: timestamp + index,
    } as T;
    await dependencies.persist(record);
  }
  return { status: 'imported', count: records.length, backupId: backup.backupId };
}
