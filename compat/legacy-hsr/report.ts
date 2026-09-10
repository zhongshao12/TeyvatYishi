import type { MigrationIssue, MigrationMapping, MigrationReport, SaveUniverseClass } from './types';

export function createMigrationReport(sourceUniverse: SaveUniverseClass): MigrationReport {
  return { sourceUniverse, appliedMappings: [], issues: [] };
}

export function addMigrationMapping(report: MigrationReport, mapping: MigrationMapping): void {
  report.appliedMappings.push(mapping);
}

export function addMigrationIssue(report: MigrationReport, issue: MigrationIssue): void {
  report.issues.push(issue);
}
