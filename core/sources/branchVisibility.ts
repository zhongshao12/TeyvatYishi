import type { CoreScope, SourceRef } from '../contracts/identity';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
export interface BranchPathEntry { scope: CoreScope; cutoffSeq: number; parent?: CoreScope; forkSeq?: number }
export interface SourceLocator { ref: SourceRef; scope: CoreScope; commitSeq: number; committed: boolean }
export interface BranchPath { scope: CoreScope; entries: BranchPathEntry[]; sources: SourceLocator[] }
const sameScope = (a: CoreScope, b: CoreScope): boolean => a.journeyId === b.journeyId && a.branchId === b.branchId;
const nat = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Uses repository-verified locators, not source names, hashes, or story timestamps. */
export function isBranchSourceReachable(ref: SourceRef, ancestry: BranchPath): boolean {
  if (!isCoreJsonData(ancestry) || !validateCoreDto('sourceRef', ref).ok || !ancestry || !validateCoreDto('scope', ancestry.scope).ok || !Array.isArray(ancestry.entries) || !Array.isArray(ancestry.sources) || ancestry.entries.length === 0) return false;
  const seen = new Set<string>();
  for (const [index, entry] of ancestry.entries.entries()) {
    if (!entry || !validateCoreDto('scope', entry.scope).ok || !nat(entry.cutoffSeq) || entry.scope.journeyId !== ancestry.scope.journeyId || seen.has(entry.scope.branchId)) return false;
    seen.add(entry.scope.branchId);
    if (index === 0 && !sameScope(entry.scope, ancestry.scope)) return false;
    const prior = ancestry.entries[index - 1];
    if (prior && (!prior.parent || !sameScope(prior.parent, entry.scope) || !nat(prior.forkSeq) || entry.cutoffSeq > prior.forkSeq)) return false;
    if ((entry.parent === undefined) !== (entry.forkSeq === undefined)) return false;
    if (entry.parent && (!validateCoreDto('scope', entry.parent).ok || !nat(entry.forkSeq) || entry.parent.journeyId !== ancestry.scope.journeyId)) return false;
  }
  if (ancestry.entries.at(-1)?.parent) return false;
  const matches = ancestry.sources.filter(source => source && source.ref?.sourceId === ref.sourceId && source.ref.sourceVersion === ref.sourceVersion);
  if (matches.length !== 1) return false;
  const source = matches[0]!;
  if (source.committed !== true || !nat(source.commitSeq) || !validateCoreDto('scope', source.scope).ok) return false;
  const entry = ancestry.entries.find(candidate => sameScope(candidate.scope, source.scope));
  return Boolean(entry && source.commitSeq <= entry.cutoffSeq);
}
