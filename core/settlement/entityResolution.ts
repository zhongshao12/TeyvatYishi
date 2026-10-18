import type { EvidenceRef, SourceRecord } from '../contracts/event';
import type { CoreSnapshot, StateRecord } from '../contracts/state';
import { validateEvidence } from '../sources/sourceRecords';
import { matchCanonical } from '@/data/canonicalCharacters';
import { isCanonicalIdentity } from '@/data/canonicalIdentity';
import { isReservedNpcIdentityName } from '@/models/npc';

export interface EntityProposal { id?: string; name?: string; evidenceRefs?: EvidenceRef[]; sources?: SourceRecord[] }
export type EntityResolution =
  | { kind: 'matched'; entityId: string; role: 'npc' | 'traveler' }
  | { kind: 'new'; name: string; canonical: boolean }
  | { kind: 'ambiguous'; entityIds: string[]; reason: string }
  | { kind: 'rejected'; reason: string };
const normalized = (value: string) => value.trim().normalize('NFKC').toLowerCase();
export function coreEntityNames(record: StateRecord<'npc' | 'traveler'>): string[] {
  const aliases = record.domain === 'npc' ? record.value.aliases : [record.value.别名];
  const canon = record.domain === 'npc' ? matchCanonical(record.value.姓名) : null;
  return [...new Set([record.value.姓名, ...aliases, ...(canon ? [canon.name, ...(canon.aliases ?? [])] : [])].filter(Boolean))];
}
/** Single-character canonical names must not match common words such as 琴声/空气/荧光. */
export function coreEntityNamePattern(record: StateRecord<'npc' | 'traveler'>, state?: CoreSnapshot): string {
  const continuations: Record<string, string> = { 琴: '声音弦', 空: '气间中白洞旷', 荧: '光幕' };
  const names = coreEntityNames(record).filter(name => !state || state.records.filter((r): r is StateRecord<'npc' | 'traveler'> => (r.domain === 'npc' || r.domain === 'traveler') && r.entityId !== record.entityId).every(r => !coreEntityNames(r).some(other => normalized(other) === normalized(name))));
  return names.map(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return continuations[name] ? `${escaped}(?![${continuations[name]}])` : /^[a-z\s]+$/iu.test(name) ? `(?<![a-z])${escaped}(?![a-z])` : escaped;
  }).join('|') || '(?!)';
}
export function resolveCoreEntity(ref: EntityProposal, state: CoreSnapshot): EntityResolution {
  const name = ref.name?.trim() ?? '';
  if (name && (isReservedNpcIdentityName(name) || /^(?:关于|提醒|近来可好)|[<>]|(?:邀约|系统提示|七维关系)/u.test(name))) return { kind: 'rejected', reason: '叙事片段或协议标签不能建人物档案。' };
  const entities = state.records.filter((r): r is StateRecord<'npc' | 'traveler'> => r.domain === 'npc' || r.domain === 'traveler');
  const matches = entities.filter(record => name && coreEntityNames(record).some(alias => normalized(alias) === normalized(name)));
  const byId = entities.find(record => record.entityId === ref.id);
  if (byId) {
    if (name && !matches.some(record => record.entityId === byId.entityId)) return { kind: 'ambiguous', entityIds: [byId.entityId, ...matches.map(r => r.entityId)], reason: '人物 ID 与姓名不相符。' };
    return { kind: 'matched', entityId: byId.entityId, role: byId.domain };
  }
  if (matches.length === 1) return { kind: 'matched', entityId: matches[0]!.entityId, role: matches[0]!.domain };
  if (matches.length > 1) return { kind: 'ambiguous', entityIds: matches.map(r => r.entityId), reason: '多个人物使用同一名字或别称。' };
  if (name && name.length <= 40 && !/[，。！？：:\n]/u.test(name)) {
    const proof = (ref.evidenceRefs ?? []).flatMap(evidence => {
      const source = ref.sources?.find(s => s.ref.sourceId === evidence.ref.sourceId && s.ref.sourceVersion === evidence.ref.sourceVersion);
      return source && source.scope.journeyId === state.head.scope.journeyId && source.scope.branchId === state.head.scope.branchId && validateEvidence(evidence, source).ok && source.kind === 'narrative' ? [evidence.quote] : [];
    });
    if (proof.some(text => text.includes(name) && /(?:自我介绍|介绍自己|我叫|我的名字是)/u.test(text) && !/(?:没有|准备|回忆|打算|假如)/u.test(text))) {
      return { kind: 'new', name: matchCanonical(name)?.name ?? name, canonical: isCanonicalIdentity(name) };
    }
  }
  return { kind: 'ambiguous', entityIds: [], reason: '找不到唯一人物，也没有可靠的当面介绍证据。' };
}
