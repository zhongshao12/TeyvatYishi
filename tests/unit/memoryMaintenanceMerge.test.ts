import { describe, expect, it } from 'vitest';
import { 创建空记忆系统, type 记忆失败草稿 } from '@/models/memory';
import { fingerprintMemoryText, type MemoryMaintenancePatch, type MemoryMaintenanceState, type MemorySourceItem } from '@/models/memorySource';
import { readMemorySourceItems } from '@/services/memorySources';
import { mergeMemoryMaintenancePatch, prepareMemoryRebuildScope } from '@/services/memoryMaintenanceMerge';
import type { IrminsulEntry } from '@/models/teyvat/irminsul';
import { createMemoryRebuildTask, type CreateMemoryRebuildTaskOptions } from '@/services/memoryRebuild';

function fixture(): MemoryMaintenanceState {
  const ids = ['before', 'inside', 'after', 'cross', 'unknown', 'edited'];
  return { memory: { ...创建空记忆系统(), 短期记忆: ids.map(id => `text-${id}`), 短期归档ID: ids,
    来源回合: { before: [9], inside: [10, 12], after: [21], cross: [9, 10], edited: [12] },
    生成文本指纹: Object.fromEntries(ids.map(id => [id, fingerprintMemoryText(id === 'edited' ? 'original' : `text-${id}`)])) },
    irminsul: { entries: [] } };
}
function source(state: MemoryMaintenanceState, id: string): MemorySourceItem {
  const item = readMemorySourceItems(state).find(item => item.id === id);
  if (!item) throw new Error(`missing fixture ${id}`);
  return item;
}
function patchFor(state: MemoryMaintenanceState): MemoryMaintenancePatch {
  return { removed: [source(state, 'inside')], added: [{ ...source(state, 'inside'), id: 'replacement', text: 'new',
    generatedFingerprint: fingerprintMemoryText('new') }], archiveUpserts: [], archiveRemoved: [], failureUpserts: [] };
}
function mustMerge(base: MemoryMaintenanceState, live: MemoryMaintenanceState, patch: MemoryMaintenancePatch): MemoryMaintenanceState {
  const result = mergeMemoryMaintenancePatch(base, live, patch);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

describe('memory maintenance source-scoped merge', () => {
  it('prepares the protected source scope when creating a rebuild task', () => {
    const task = createMemoryRebuildTask({ sourceState: fixture(), range: { start: 10, end: 20 }, batchSize: 15,
      chatHistory: [{ id: 'u10', role: 'user', content: '输入', timestamp: 1, gameTime: '10' },
        { id: 'a10', role: 'assistant', content: '完整正文', timestamp: 2, gameTime: '10' }],
    } as CreateMemoryRebuildTaskOptions);
    expect((task as typeof task & { rebuildScope?: ReturnType<typeof prepareMemoryRebuildScope> }).rebuildScope?.replaceable.map(item => item.id)).toEqual(['inside']);
  });
  it('retains outside, cross-boundary, unknown and player-edited sources for a 10–20 rebuild', () => {
    const scope = prepareMemoryRebuildScope(fixture(), { start: 10, end: 20 });
    expect(scope.replaceable.map(item => item.id)).toEqual(['inside']);
    expect(scope.retained.map(item => item.id)).toEqual(['before', 'after', 'cross', 'unknown', 'edited']);
    expect(scope.warnings.length).toBeGreaterThan(0);
  });

  it('accepts legacy text only with a unique exact archive association, not a coincidentally matching text', () => {
    const state: MemoryMaintenanceState = { memory: { ...创建空记忆系统(), 短期记忆: ['old', 'old'], 短期归档ID: ['old-id', null] },
      irminsul: { entries: [{ id: 'old-id', title: 'old', summary: 'old', sourceText: 'raw', sourceTurns: [10],
        keywords: [], recordedAt: '', archiveType: 'short', turn: 10 }] } };
    expect(prepareMemoryRebuildScope(state, { start: 10, end: 20 }).replaceable.map(item => item.id)).toEqual(['old-id']);
  });

  it('merges sparse new turns without fabricating 11 and keeps unrelated live edits and additions', () => {
    const base = fixture();
    const live = structuredClone(base);
    live.memory.短期记忆[0] = 'player changed outside';
    live.memory.即时记忆.push('new immediate');
    const merged = mustMerge(base, live, patchFor(base));
    expect(merged.memory.短期记忆).toEqual(['player changed outside', 'text-after', 'text-cross', 'text-unknown', 'text-edited', 'new']);
    expect(merged.memory.即时记忆).toEqual(['new immediate']);
    expect(merged.memory.来源回合?.replacement).toEqual([10, 12]);
    expect(merged.memory.来源回合?.inside).toBeUndefined();
    expect(merged.memory.生成文本指纹?.replacement).toBe(fingerprintMemoryText('new'));
  });

  it.each(['deleted', 'edited', 'moved', 'provenance'] as const)('rejects a %s processing source without resurrecting it', change => {
    const base = fixture(); const live = structuredClone(base);
    if (change === 'deleted' || change === 'moved') { live.memory.短期记忆.splice(1, 1); live.memory.短期归档ID?.splice(1, 1); }
    if (change === 'edited') live.memory.短期记忆[1] = 'player edit';
    if (change === 'moved') { live.memory.中期记忆 = ['text-inside']; live.memory.中期归档ID = ['inside']; }
    if (change === 'provenance') live.memory.来源回合 = { ...live.memory.来源回合, inside: [10, 11, 12] };
    const snapshot = structuredClone(live);
    expect(mergeMemoryMaintenancePatch(base, live, patchFor(base))).toMatchObject({ ok: false, code: 'source_changed' });
    expect(live).toEqual(snapshot);
  });

  it('is idempotent only after the whole patch has landed, not when only its new summary is present', () => {
    const base = fixture(); const patch = patchFor(base);
    const once = mustMerge(base, base, patch);
    expect(mustMerge(base, once, patch)).toEqual(once);
    const partial = structuredClone(base);
    partial.memory.短期记忆.push('new'); partial.memory.短期归档ID?.push('replacement');
    expect(mergeMemoryMaintenancePatch(base, partial, patch)).toMatchObject({ ok: false });
  });

  it('never removes a same-text source with another identity and rejects duplicate IDs', () => {
    const base = fixture(); const live = structuredClone(base);
    live.memory.短期记忆.push('text-inside'); live.memory.短期归档ID?.push('other');
    expect(mustMerge(base, live, patchFor(base)).memory.短期归档ID).toContain('other');
    live.memory.短期归档ID![live.memory.短期归档ID!.length - 1] = 'inside';
    expect(mergeMemoryMaintenancePatch(base, live, patchFor(base))).toMatchObject({ ok: false });
  });

  it('does not hide added-ID collisions behind malformed duplicated live identities', () => {
    const base = fixture(); const live = structuredClone(base);
    live.memory.即时记忆 = ['one', 'two']; live.memory.即时记忆ID = ['replacement', 'replacement'];
    expect(mergeMemoryMaintenancePatch(base, live, patchFor(base))).toMatchObject({ ok: false });
  });

  it('preserves world-tree originals unless the patch proves complete fact coverage', () => {
    const base = fixture();
    const original: IrminsulEntry = { id: 'original', title: 'original', summary: 'met Amber', sourceText: 'met Amber\nobtained letter',
      sourceTurns: [10], keywords: [], recordedAt: '', archiveType: 'short', turn: 10 };
    base.irminsul.entries = [original];
    const upper: IrminsulEntry = { ...original, id: 'upper', archiveType: 'medium', summary: 'met Amber', coveredEntryIds: ['original'] };
    const patch = { ...patchFor(base), archiveRemoved: [original], archiveUpserts: [upper] };
    expect(mergeMemoryMaintenancePatch(base, base, patch)).toMatchObject({ ok: false });
    upper.summary = original.sourceText;
    expect(mustMerge(base, base, patch).irminsul.entries.map(item => item.id)).toEqual(['upper']);
  });

  it('does not alter unrelated failure drafts and refuses overwriting a concurrently edited archive', () => {
    const base = fixture();
    const outside = { id: 'outside-draft', status: 'pending', sourceTurns: { start: 1, end: 2 } } as 记忆失败草稿;
    base.memory.失败草稿 = [outside];
    expect(mustMerge(base, base, patchFor(base)).memory.失败草稿).toEqual([outside]);
    const original: IrminsulEntry = { id: 'a', title: 'a', summary: 'fact', sourceText: 'fact', sourceTurns: [10],
      keywords: [], recordedAt: '', archiveType: 'short', turn: 10 };
    base.irminsul.entries = [original];
    const live = structuredClone(base); live.irminsul.entries[0]!.sourceText = 'player edit';
    const patch = { ...patchFor(base), archiveUpserts: [{ ...original, summary: 'new' }] };
    expect(mergeMemoryMaintenancePatch(base, live, patch)).toMatchObject({ ok: false });
  });

  it('rejects changed archive input even when its original will be retained rather than deleted', () => {
    const base = fixture();
    const archive: IrminsulEntry = { id: 'inside', title: 'inside', summary: 'text-inside', sourceText: 'original facts',
      sourceTurns: [10, 12], keywords: [], recordedAt: '', archiveType: 'short', turn: 12 };
    base.irminsul.entries = [archive];
    const live = structuredClone(base); live.irminsul.entries[0]!.sourceText = 'new player facts';
    expect(mergeMemoryMaintenancePatch(base, live, patchFor(base))).toMatchObject({ ok: false });
  });

  it('checks explicit read-only archive sources for world-tree-only operations', () => {
    const base = fixture();
    const archive: IrminsulEntry = { id: 'tree-only', title: 'tree-only', summary: 'fact', sourceText: 'original facts',
      sourceTurns: [10], keywords: [], recordedAt: '', archiveType: 'short', turn: 10 };
    base.irminsul.entries = [archive];
    const live = structuredClone(base); live.irminsul.entries[0]!.sourceText = 'new player facts';
    const patch = { removed: [], added: [], archiveRemoved: [], failureUpserts: [], archiveSources: [archive],
      archiveUpserts: [{ ...archive, id: 'new-summary', archiveType: 'medium' as const }] };
    expect(mergeMemoryMaintenancePatch(base, live, patch)).toMatchObject({ ok: false });
  });
});
