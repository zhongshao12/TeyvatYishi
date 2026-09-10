import type { ElementId, TeyvatGameState } from '@/models/teyvat';

export type SaveUniverseClass = 'teyvat' | 'partial-teyvat' | 'legacy-hsr' | 'unknown';

export interface MigrationIssue {
  code: 'UNRESOLVED_ELEMENT' | 'UNRESOLVED_RARITY';
  path: string;
  value: unknown;
  message: string;
}

export interface MigrationMapping {
  from: string;
  to: string;
  value: unknown;
}

export interface MigrationReport {
  sourceUniverse: SaveUniverseClass;
  appliedMappings: MigrationMapping[];
  issues: MigrationIssue[];
}

export interface MigrationResolutions {
  /** Explicit user choices for legacy path IDs with no deterministic equivalent. */
  elementByLegacyPath?: Readonly<Record<string, ElementId>>;
  /** Explicit user choices for legacy rarity values that cannot be normalized directly. */
  rarityByLegacyValue?: Readonly<Record<string, number>>;
}

export type SaveMigrationResult =
  | { status: 'migrated'; state: TeyvatGameState; report: MigrationReport }
  | { status: 'needs-input'; issues: MigrationIssue[]; report: MigrationReport }
  | { status: 'legacy-universe'; raw: unknown; report: MigrationReport }
  | { status: 'invalid'; errors: string[]; report: MigrationReport };

export type DbSaveClassificationResult =
  | { kind: 'teyvat'; state: TeyvatGameState; report: MigrationReport }
  | { kind: 'needs-input'; issues: MigrationIssue[]; report: MigrationReport }
  | { kind: 'legacy-hsr'; raw: unknown; report: MigrationReport }
  | { kind: 'invalid'; errors: string[]; report: MigrationReport };
