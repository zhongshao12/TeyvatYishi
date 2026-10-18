import type { CoreScope } from '../contracts/identity';
import type { SourceRecord, SourceBlock, SourceKind, EvidenceRef } from '../contracts/event';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
export type InputSourceBlock = SourceBlock | { blockId: string; kind: 'analysis' | 'protocol' | 'variables'; text: string };
export interface SourceInput { scope: CoreScope; operationId: string; kind: SourceKind; blocks: InputSourceBlock[]; moment: WorldMoment; createdAt?: number; previous?: SourceRecord; delivery?: SourceRecord['delivery']; publicCitations?: SourceRecord['publicCitations']; assetRefs?: string[] }
export type EvidenceCheck = { ok: true } | { ok: false; code: 'source_mismatch' | 'version_mismatch' | 'out_of_bounds' | 'quote_mismatch' | 'invalid_ref' };
const visibleKinds = new Set(['narration', 'dialogue', 'message', 'configuration', 'rule', 'content']);
const hiddenKinds = new Set(['analysis', 'protocol', 'variables']);
const inputKeys = new Set(['scope', 'operationId', 'kind', 'blocks', 'moment', 'createdAt', 'previous', 'delivery', 'publicCitations', 'assetRefs']);

function deepFreeze(value: object): void {
  for (const child of Object.values(value)) if (child !== null && typeof child === 'object') deepFreeze(child);
  Object.freeze(value);
}

export function freezeSource(input: SourceInput): SourceRecord {
  if (!isCoreJsonData(input) || !input || Array.isArray(input) || typeof input !== 'object' || !Object.keys(input).every(key => inputKeys.has(key)) || !Array.isArray(input.blocks)) throw new Error('CORE2_INVALID_SOURCE_INPUT');
  if (!input.blocks.every(block => block && typeof block === 'object' && (visibleKinds.has(block.kind) || hiddenKinds.has(block.kind)))) throw new Error('CORE2_INVALID_SOURCE_BLOCK');
  if (input.previous !== undefined) {
    if (!validateCoreDto('source', input.previous).ok || input.previous.scope.journeyId !== input.scope?.journeyId || input.previous.kind !== input.kind) throw new Error('CORE2_SOURCE_EDIT_MISMATCH');
  }
  const visible = input.blocks.filter((block): block is SourceBlock => visibleKinds.has(block.kind));
  if (new Set(visible.map(block => block.blockId)).size !== visible.length) throw new Error('CORE2_DUPLICATE_BLOCK_ID');
  const source: SourceRecord = {
    ref: { sourceId: input.previous?.ref.sourceId ?? crypto.randomUUID(), sourceVersion: (input.previous?.ref.sourceVersion ?? 0) + 1 },
    scope: input.scope, operationId: input.operationId, kind: input.kind, blocks: visible,
    moment: { ...input.moment, settlementId: input.operationId }, createdAt: input.createdAt === undefined ? Date.now() : input.createdAt,
    ...(input.delivery ? { delivery: input.delivery } : {}),
    ...(input.publicCitations ? { publicCitations: input.publicCitations } : {}),
    ...(input.assetRefs ? { assetRefs: input.assetRefs } : {}),
  };
  if (!validateCoreDto('source', source).ok) throw new Error('CORE2_INVALID_SOURCE');
  const owned = structuredClone(source);
  deepFreeze(owned);
  return owned;
}

/** Provenance only. An exact quote still does not prove the action actually happened. */
export function validateEvidence(ref: EvidenceRef, source: SourceRecord): EvidenceCheck {
  if (!validateCoreDto('evidence', ref).ok || !validateCoreDto('source', source).ok) return { ok: false, code: 'invalid_ref' };
  if (ref.ref.sourceId !== source.ref.sourceId) return { ok: false, code: 'source_mismatch' };
  if (ref.ref.sourceVersion !== source.ref.sourceVersion) return { ok: false, code: 'version_mismatch' };
  const blocks = source.blocks.filter(block => block.blockId === ref.blockId);
  if (blocks.length !== 1) return { ok: false, code: 'invalid_ref' };
  const block = blocks[0]!;
  if (ref.end > block.text.length) return { ok: false, code: 'out_of_bounds' };
  return block.text.slice(ref.start, ref.end) === ref.quote ? { ok: true } : { ok: false, code: 'quote_mismatch' };
}
