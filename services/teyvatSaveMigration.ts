import {
  migratePartialTeyvatSave,
  type SaveMigrationResult,
} from '@/compat/legacy-hsr/migrate';
import type { MigrationResolutions } from '@/compat/legacy-hsr/types';
import type { TeyvatGameState } from '@/models/teyvat';

export interface AtomicTeyvatMigrationStorage {
  readCatalogBytes: () => string | Promise<string>;
  writeCandidateAtomically: (candidate: TeyvatGameState) => Promise<unknown>;
}

/**
 * Produces and persists a partial-Teyvat migration candidate without ever
 * mutating or rewriting the historical source object. Only a fully resolved
 * candidate reaches the injected atomic storage writer; write failures remain
 * failures and leave the caller's prior storage/catalog snapshot authoritative.
 */
export async function persistPartialTeyvatMigration(
  source: unknown,
  resolutions: MigrationResolutions,
  storage: AtomicTeyvatMigrationStorage,
): Promise<SaveMigrationResult> {
  const migration = migratePartialTeyvatSave(source, resolutions);
  if (migration.status !== 'migrated') return migration;
  const catalogBytesBefore = await storage.readCatalogBytes();
  try {
    await storage.writeCandidateAtomically(migration.state);
  } catch (cause) {
    const catalogBytesAfter = await storage.readCatalogBytes();
    if (catalogBytesAfter !== catalogBytesBefore) {
      throw new Error('TEYVAT_MIGRATION_ATOMICITY_VIOLATION', { cause });
    }
    throw cause;
  }
  return migration;
}
