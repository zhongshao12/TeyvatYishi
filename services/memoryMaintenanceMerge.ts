import type { MemoryMaintenancePatch, MemoryMaintenanceState, MemorySourceItem } from '@/models/memorySource';
import type { MemoryRebuildRange } from './memoryRebuild';
import { fingerprintMemoryText, memorySourceValuesEqual as same } from '@/models/memorySource';
import { readMemorySourceItems } from './memorySources';
import { hasVerifiedIrminsulCoverage, type IrminsulEntry } from '@/models/teyvat/irminsul';
import type { 记忆系统 } from '@/models/memory';

const layerFields = {
  immediate: ['即时记忆', '即时记忆ID'], short: ['短期记忆', '短期归档ID'],
  middle: ['中期记忆', '中期归档ID'], long: ['长期记忆', '长期归档ID'],
} as const;
const reject = () => ({ ok: false as const, code: 'source_changed' as const, message: '处理来源已被修改、删除或部分写入，原记忆保持不变。' });

export function prepareMemoryRebuildScope(state: MemoryMaintenanceState, range: MemoryRebuildRange): {
  replaceable: MemorySourceItem[]; retained: MemorySourceItem[]; warnings: string[];
} {
  const replaceable: MemorySourceItem[] = []; const retained: MemorySourceItem[] = [];
  const warnings = new Set<string>();
  const start = range.start ?? 0; const end = range.end ?? Number.MAX_SAFE_INTEGER;
  for (const item of readMemorySourceItems(state)) {
    const matches = state.irminsul.entries.filter(entry => entry.id === item.id);
    const archiveProvesOriginal = matches.length === 1 && matches[0]?.summary === item.text && matches[0]?.status !== 'pending';
    const original = item.generatedFingerprint ? item.generatedFingerprint === fingerprintMemoryText(item.text) : archiveProvesOriginal;
    const known = Boolean(item.id && item.sourceTurns.length);
    const inRange = known && item.sourceTurns.every(turn => turn >= start && turn <= end);
    if (inRange && original) replaceable.push(item);
    else {
      retained.push(item);
      if (!known) warnings.add('部分旧记忆缺少可靠来源，已保留。');
      else if (item.sourceTurns.some(turn => turn >= start && turn <= end) && !inRange) warnings.add('跨越所选范围的旧摘要已保留。');
      else if (inRange && !original) warnings.add('玩家编辑或无法证明原值的记忆已保留。');
    }
  }
  return { replaceable, retained, warnings: [...warnings] };
}

function uniqueById<T extends { id: string | null }>(items: readonly T[]): Map<string, T> | null {
  const result = new Map<string, T>();
  for (const item of items) {
    if (!item.id?.trim() || result.has(item.id)) return null;
    result.set(item.id, item);
  }
  return result;
}

export function mergeMemoryMaintenancePatch(base: MemoryMaintenanceState, live: MemoryMaintenanceState, patch: MemoryMaintenancePatch):
  { ok: true; state: MemoryMaintenanceState } | { ok: false; code: 'source_changed'; message: string } {
  const baseItems = readMemorySourceItems(base); const liveItems = readMemorySourceItems(live);
  const rawIds = (state: MemoryMaintenanceState) => Object.values(layerFields).flatMap(([textField, idField]) =>
    state.memory[textField].map((_, index) => state.memory[idField]?.[index] ?? null));
  const removed = uniqueById(patch.removed); const added = uniqueById(patch.added);
  const removedArchives = uniqueById(patch.archiveRemoved); const upserts = uniqueById(patch.archiveUpserts);
  const archiveSources = uniqueById(patch.archiveSources ?? []);
  const failures = uniqueById(patch.failureUpserts);
  if (!removed || !added || !removedArchives || !upserts || !failures || !archiveSources) return reject();
  const findSource = (items: MemorySourceItem[], id: string) => items.filter(item => item.id === id);
  const findArchive = (state: MemoryMaintenanceState, id: string) => state.irminsul.entries.filter(entry => entry.id === id);
  // Full replay only: a missing old source alone is not evidence of a committed patch.
  const replay = (patch.added.length + patch.archiveUpserts.length + patch.failureUpserts.length) > 0
    && patch.removed.every(item => !findSource(liveItems, item.id!).length)
    && patch.added.every(item => { const found = findSource(liveItems, item.id!); return found.length === 1 && same(found[0], item); })
    && patch.archiveRemoved.every(entry => !findArchive(live, entry.id).length)
    && patch.archiveUpserts.every(entry => { const found = findArchive(live, entry.id); return found.length === 1 && same(found[0], entry); })
    && patch.failureUpserts.every(draft => { const found = (live.memory.失败草稿 ?? []).filter(item => item.id === draft.id); return found.length === 1 && same(found[0], draft); });
  if (replay) return { ok: true, state: live };
  for (const entry of patch.archiveSources ?? []) {
    const fromBase = findArchive(base, entry.id); const fromLive = findArchive(live, entry.id);
    if (fromBase.length !== 1 || fromLive.length !== 1 || !same(fromBase[0], entry) || !same(fromLive[0], entry)) return reject();
  }
  for (const item of patch.removed) {
    const fromBase = findSource(baseItems, item.id!); const fromLive = findSource(liveItems, item.id!);
    if (fromBase.length !== 1 || fromLive.length !== 1 || !same(fromBase[0], item) || !same(fromLive[0], item)) return reject();
    for (const id of [item.id!, ...item.sourceEntryIds]) {
      const baseArchives = findArchive(base, id); const liveArchives = findArchive(live, id);
      if (baseArchives.length > 1 || liveArchives.length > 1 || !same(baseArchives, liveArchives)) return reject();
    }
  }
  for (const item of patch.added) if (rawIds(live).includes(item.id) || rawIds(base).includes(item.id)) return reject();
  for (const entry of [...patch.archiveRemoved, ...patch.archiveUpserts]) {
    const fromBase = findArchive(base, entry.id); const fromLive = findArchive(live, entry.id);
    if (fromBase.length > 1 || fromLive.length > 1 || !same(fromBase, fromLive)) return reject();
    if (removedArchives.has(entry.id) && (fromBase.length !== 1 || !same(fromBase[0], entry))) return reject();
  }
  for (const draft of patch.failureUpserts) {
    const fromBase = (base.memory.失败草稿 ?? []).filter(item => item.id === draft.id);
    const fromLive = (live.memory.失败草稿 ?? []).filter(item => item.id === draft.id);
    if (fromBase.length > 1 || fromLive.length > 1 || !same(fromBase, fromLive)) return reject();
  }
  // Deleting an archive needs proof of all facts, independently of array-layer replacement.
  const coverageSources = [...live.irminsul.entries.filter(entry => !upserts.has(entry.id)), ...patch.archiveUpserts];
  const survivingProofs = coverageSources.filter(entry => !removedArchives.has(entry.id));
  for (const entry of patch.archiveRemoved) {
    if (!survivingProofs.some(upper => upper.coveredEntryIds?.includes(entry.id)
      && hasVerifiedIrminsulCoverage(coverageSources.filter(source => source.id !== upper.id), upper))) return reject();
  }
  const memory: 记忆系统 = { ...live.memory };
  for (const layer of Object.keys(layerFields) as Array<keyof typeof layerFields>) {
    const [textField, idField] = layerFields[layer];
    const retained = live.memory[textField].flatMap((text, index) => {
      const id = live.memory[idField]?.[index] ?? null;
      return id && removed.has(id) ? [] : [{ text, id }];
    });
    retained.push(...patch.added.filter(item => item.layer === layer).map(item => ({ text: item.text, id: item.id })));
    memory[textField] = retained.map(item => item.text);
    if (live.memory[idField] || patch.added.some(item => item.layer === layer)) memory[idField] = retained.map(item => item.id);
  }
  const sourceTurns = { ...live.memory.来源回合 }; const fingerprints = { ...live.memory.生成文本指纹 };
  const moments = { ...live.memory.来源时刻 };
  for (const id of removed.keys()) { delete sourceTurns[id]; delete fingerprints[id]; delete moments[id]; }
  for (const item of patch.added) {
    sourceTurns[item.id!] = [...item.sourceTurns];
    if (item.generatedFingerprint) fingerprints[item.id!] = item.generatedFingerprint;
    if (item.momentRange) moments[item.id!] = item.momentRange;
  }
  if (live.memory.来源回合 || patch.added.length) memory.来源回合 = sourceTurns;
  if (live.memory.生成文本指纹 || Object.keys(fingerprints).length) memory.生成文本指纹 = fingerprints;
  if (live.memory.来源时刻 || Object.keys(moments).length) memory.来源时刻 = moments;
  if (live.memory.失败草稿 || patch.failureUpserts.length) memory.失败草稿 = [
    ...(live.memory.失败草稿 ?? []).filter(draft => !failures.has(draft.id)), ...patch.failureUpserts,
  ];
  const entries: IrminsulEntry[] = [
    ...live.irminsul.entries.filter(entry => !removedArchives.has(entry.id) && !upserts.has(entry.id)), ...patch.archiveUpserts,
  ];
  return { ok: true, state: { memory, irminsul: { entries } } };
}
