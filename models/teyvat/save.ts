import type { SaveMigrationResult } from '@/compat/legacy-hsr/migrate';
import type { TeyvatSaveData } from './state';

export interface TeyvatSaveManifest {
  app: 'KaiTuoYiShi';
  kind: 'save-package' | 'save-tree-package';
  format: 'ktysave';
  packageVersion: number;
  universe: 'teyvat';
  schemaVersion: 2;
  files: string[];
}

export type ParsedSavePackage =
  | { kind: 'teyvat'; manifest: TeyvatSaveManifest; save: TeyvatSaveData }
  | { kind: 'partial-teyvat'; raw: unknown; sourceBackupRaw: unknown; sourceJsonBytes: string; migration: SaveMigrationResult }
  | { kind: 'legacy-hsr'; raw: unknown }
  | { kind: 'invalid'; errors: string[] };
