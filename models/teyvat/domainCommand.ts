export const TEYVAT_DOMAIN_ROOTS = ['旅行者', '世界', 'NPC', '背包', '任务', '信使', '原著轨道'] as const;
export type TeyvatDomainRoot = typeof TEYVAT_DOMAIN_ROOTS[number];

export const TEYVAT_DOMAIN_ACTIONS = ['set', 'add', 'sub', 'push', 'delete'] as const;
export type TeyvatDomainAction = typeof TEYVAT_DOMAIN_ACTIONS[number];

export interface TeyvatDomainCommand {
  action: TeyvatDomainAction;
  root: TeyvatDomainRoot;
  path: string;
  value?: unknown;
  evidence: string;
}

/** Shared grammar for generated values and every `[id=...]` selector. */
export const TEYVAT_STABLE_ID_PATTERN = /^[\p{L}\p{N}_.:%-]+$/u;

export function isTeyvatStableId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && TEYVAT_STABLE_ID_PATTERN.test(value);
}

export function buildTeyvatStableId(prefix: string, parts: readonly (string | number)[]): string {
  const encodedPrefix = encodeURIComponent(prefix.trim().toLowerCase()).replace(/%20/g, '_');
  const encodedParts = parts.map((part) => encodeURIComponent(String(part).trim().toLowerCase()).replace(/%20/g, '_'));
  return [encodedPrefix || 'id', ...encodedParts.filter(Boolean)].join(':').slice(0, 240);
}

export function buildTeyvatIdSelector(id: string): string {
  if (!isTeyvatStableId(id)) throw new Error('INVALID_TEYVAT_STABLE_ID');
  return `[id=${id}]`;
}

export type TeyvatTurnErrorCode =
  | 'INVALID_COMMAND'
  | 'INVALID_ACTION'
  | 'UNKNOWN_ROOT'
  | 'EMPTY_PATH'
  | 'UNSAFE_PATH'
  | 'WILDCARD_PATH'
  | 'DYNAMIC_SELECTOR'
  | 'WHOLE_DOMAIN_REPLACE'
  | 'LEGACY_PATH'
  | 'UNKNOWN_PATH'
  | 'INVALID_VALUE'
  | 'INVALID_NUMERIC_RESULT'
  | 'MISSING_TARGET_ID'
  | 'MISSING_EVIDENCE'
  | 'UNMATCHED_EVIDENCE'
  | 'COMMIT_FAILED';

export interface TeyvatTurnError {
  index: number;
  code: TeyvatTurnErrorCode;
  root?: string;
  path?: string;
}
