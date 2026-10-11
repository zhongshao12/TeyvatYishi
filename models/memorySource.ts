import type { 记忆系统, 记忆失败草稿 } from './memory';
import type { IrminsulEntry, IrminsulMemory } from './teyvat/irminsul';
import type { WorldMomentRange } from './teyvat/worldMoment';

export type MemorySourceLayer = 'immediate' | 'short' | 'middle' | 'long';
export interface MemorySourceItem {
  id: string | null;
  layer: MemorySourceLayer;
  text: string;
  sourceTurns: number[];
  sourceMessageIds: string[];
  sourceEntryIds: string[];
  momentRange: WorldMomentRange | null;
  generatedFingerprint: string | null;
}
export interface MemoryMaintenanceState { memory: 记忆系统; irminsul: IrminsulMemory }
export interface MemoryLayerThresholds { immediateToShort: number; shortToMiddle: number; middleToLong: number }
export interface MemoryMaintenanceProgress {
  phase: 'turns' | 'short' | 'middle' | 'long' | 'saving';
  processedTurns: number;
  totalTurns: number;
  currentTurn: number | null;
}
export interface MemoryMaintenancePatch {
  sourceReads?: MemorySourceItem[];
  removed: MemorySourceItem[];
  added: MemorySourceItem[];
  archiveUpserts: IrminsulEntry[];
  archiveRemoved: IrminsulEntry[];
  /** Original archives read by the request, including evidence that is retained rather than retired. */
  archiveSources?: IrminsulEntry[];
  failureUpserts: 记忆失败草稿[];
}

export function normalizeSourceTurns(value: unknown): number[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((turn): turn is number => typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 0))].sort((a, b) => a - b)
    : [];
}
export function normalizeSourceTurnsMap(value: unknown): Record<string, number[]> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value).flatMap(([id, turns]) => id.trim() && Array.isArray(turns) ? [[id, normalizeSourceTurns(turns)]] : []));
}
export function normalizeGeneratedFingerprints(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([id, fingerprint]) => id.trim() && typeof fingerprint === 'string' && fingerprint.trim()));
}
/** Change detection only, never authorization: commits must also compare the original text. */
export function fingerprintMemoryText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return `fnv1a:${text.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Value comparison for JSON DTOs; object field order is not a source change. */
export function memorySourceValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((item, index) => memorySourceValuesEqual(item, right[index]));
  const a = left as Record<string, unknown>; const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && memorySourceValuesEqual(a[key], b[key]));
}
