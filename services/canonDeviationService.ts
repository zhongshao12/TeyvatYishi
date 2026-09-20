import {
  TEYVAT_CANON_ANCHOR_IDS,
  type CanonDeviation,
  type CanonDeviationInput,
  type CanonDeviationStatus,
  type CanonReturnability,
  type CanonTrack,
  type TeyvatCanonAnchorId,
} from '@/models/teyvat/canon';

const CANON_ANCHORS = new Set<string>(TEYVAT_CANON_ANCHOR_IDS);
const STATUSES = new Set<CanonDeviationStatus>(['active', 'resolved', 'archived']);
const RETURNABILITY = new Set<CanonReturnability>(['none', 'conditional', 'open']);

function normalizeAnchor(value: unknown): TeyvatCanonAnchorId | null {
  if (typeof value !== 'string') return null;
  const anchor = value.trim();
  return CANON_ANCHORS.has(anchor) ? anchor as TeyvatCanonAnchorId : null;
}

function normalizeTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function normalizeAnchorList(value: unknown): TeyvatCanonAnchorId[] {
  if (!Array.isArray(value)) return [];
  const result: TeyvatCanonAnchorId[] = [];
  for (const item of value) {
    const anchor = normalizeAnchor(item);
    if (anchor && !result.includes(anchor)) result.push(anchor);
  }
  return result;
}

function stableDeviationId(anchorId: TeyvatCanonAnchorId, turn: number): string {
  return `canon-deviation:${anchorId}:${turn}`;
}

export function normalizeCanonDeviation(input: unknown): CanonDeviation | null {
  if (!isRecord(input)) return null;
  const anchorId = normalizeAnchor(input.anchorId);
  const turn = typeof input.turn === 'number' && Number.isFinite(input.turn) && Number.isInteger(input.turn)
    ? input.turn
    : -1;
  const status = typeof input.status === 'string' && STATUSES.has(input.status as CanonDeviationStatus)
    ? input.status as CanonDeviationStatus
    : null;
  const returnability = typeof input.returnability === 'string' && RETURNABILITY.has(input.returnability as CanonReturnability)
    ? input.returnability as CanonReturnability
    : null;
  if (!anchorId || turn < 0 || !status || !returnability) return null;
  return {
    id: stableDeviationId(anchorId, turn),
    anchorId,
    turn,
    evidence: normalizeTextList(input.evidence),
    affectedCharacters: normalizeTextList(input.affectedCharacters),
    worldEffects: normalizeTextList(input.worldEffects),
    blockedAnchorIds: normalizeAnchorList(input.blockedAnchorIds),
    status,
    returnability,
  };
}

function uniqueText(existing: readonly string[], incoming: readonly string[]): string[] {
  return normalizeTextList([...existing, ...incoming]);
}

function uniqueAnchors(
  existing: readonly TeyvatCanonAnchorId[],
  incoming: readonly TeyvatCanonAnchorId[],
): TeyvatCanonAnchorId[] {
  return normalizeAnchorList([...existing, ...incoming]);
}

export function mergeCanonDeviation(existing: CanonDeviation, incoming: CanonDeviation): CanonDeviation {
  const left = normalizeCanonDeviation(existing);
  const right = normalizeCanonDeviation(incoming);
  if (!left && !right) throw new Error('INVALID_CANON_DEVIATION');
  if (!left) return right as CanonDeviation;
  if (!right || left.id !== right.id) return left;
  return {
    id: left.id,
    anchorId: left.anchorId,
    turn: left.turn,
    evidence: uniqueText(left.evidence, right.evidence),
    affectedCharacters: uniqueText(left.affectedCharacters, right.affectedCharacters),
    worldEffects: uniqueText(left.worldEffects, right.worldEffects),
    blockedAnchorIds: uniqueAnchors(left.blockedAnchorIds, right.blockedAnchorIds),
    status: right.status,
    returnability: right.returnability,
  };
}

export function normalizeCanonTrack(input: unknown): CanonTrack {
  const raw = isRecord(input) ? input : {};
  const deviations: CanonDeviation[] = [];
  if (Array.isArray(raw.deviations)) {
    for (const candidate of raw.deviations) {
      const normalized = normalizeCanonDeviation(candidate);
      if (!normalized) continue;
      const index = deviations.findIndex((item) => item.id === normalized.id);
      const existing = deviations[index];
      if (index >= 0 && existing) deviations[index] = mergeCanonDeviation(existing, normalized);
      else deviations.push(normalized);
    }
  }
  return {
    currentAnchor: normalizeAnchor(raw.currentAnchor) ?? '',
    deviations,
    notes: normalizeTextList(raw.notes),
  };
}

export function recordCanonDeviation(track: CanonTrack, input: CanonDeviationInput): CanonTrack {
  const normalizedTrack = normalizeCanonTrack(track);
  const incoming = normalizeCanonDeviation(input);
  if (!incoming) return normalizedTrack;
  const existingIndex = normalizedTrack.deviations.findIndex((item) => item.id === incoming.id);
  const deviations = existingIndex >= 0
    ? normalizedTrack.deviations.map((item, index) => index === existingIndex ? mergeCanonDeviation(item, incoming) : item)
    : [...normalizedTrack.deviations, incoming];
  return {
    currentAnchor: incoming.anchorId,
    deviations,
    notes: [...normalizedTrack.notes],
  };
}

const RETURNABILITY_TEXT: Record<CanonReturnability, string> = {
  none: 'none：该结果不可回归原著路线。',
  conditional: 'conditional：仅在玩家已建立事实不被推翻且新的回归条件明确成立时，才可重新接入。',
  open: 'open：允许寻找新的接入点，但必须保留玩家已建立事实与世界影响。',
};

function formatDeviation(deviation: CanonDeviation): string {
  return [
    `## 偏离 ${deviation.id}`,
    `原锚点：${deviation.anchorId}｜发生回合：${deviation.turn}｜状态：${deviation.status}`,
    `玩家已建立事实：${deviation.evidence.join('；') || '已记录偏离，但尚无补充证据。'}`,
    deviation.affectedCharacters.length ? `受影响角色：${deviation.affectedCharacters.join('、')}` : '',
    deviation.worldEffects.length ? `世界影响：${deviation.worldEffects.join('；')}` : '',
    `已阻断后续锚点：${deviation.blockedAnchorIds.join('、') || '无'}`,
    `回归路径：${RETURNABILITY_TEXT[deviation.returnability]}`,
    '硬约束：玩家已建立事实优先于未来原著锚点；不得重演原事件结果，不得仅因旧关键词命中而推进已阻断锚点。',
  ].filter(Boolean).join('\n');
}

export function buildCanonContextWindow(trackOrDeviation: CanonTrack | CanonDeviation): string {
  const deviations = 'deviations' in trackOrDeviation
    ? normalizeCanonTrack(trackOrDeviation).deviations
    : [normalizeCanonDeviation(trackOrDeviation)].filter((item): item is CanonDeviation => Boolean(item));
  if (!deviations.length) return '';
  return ['# 玩家已建立的原著偏离', ...deviations.map(formatDeviation)].join('\n\n');
}

export function getBlockedCanonAnchorIds(track?: CanonTrack): Set<TeyvatCanonAnchorId> {
  const blocked = new Set<TeyvatCanonAnchorId>();
  for (const deviation of normalizeCanonTrack(track).deviations) {
    for (const anchor of deviation.blockedAnchorIds) blocked.add(anchor);
  }
  return blocked;
}
import { isRecord } from '@/utils/valueGuards';
