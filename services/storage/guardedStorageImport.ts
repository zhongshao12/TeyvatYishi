export interface StorageImportRecord {
  id?: number;
  type?: string;
  timestamp?: number;
}

export interface GuardedStorageImportDependencies<T extends StorageImportRecord> {
  parse: (file: File) => Promise<T[]>;
  confirm: (message: string) => boolean;
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
  const confirmed = dependencies.confirm(
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
