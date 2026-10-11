import { describe, expect, it } from 'vitest';
import { selectSaveNodeRotationCandidates } from '@/services/storage/saveRetention';
import { normalizeSaveCatalogRecord } from '@/services/storage/saveCatalog';

const node = (id: number, turnCount: number, timestamp = id, rootId = 'root-a') => ({
  id, type: 'auto', timestamp, turnCount, turnCountSource: 'explicit' as const, saveTree: { rootId },
});
const ids = (items: ReturnType<typeof node>[]) => selectSaveNodeRotationCandidates(items).map(item => item.id);
describe('ten distinct trustworthy automatic rounds', () => {
  it('retains ten rounds and every branch/repeated write of the newest round', () => {
    expect(ids([...Array.from({ length: 11 }, (_, i) => node(i + 1, i + 1)), node(12, 11), node(13, 11)])).toEqual([1]);
  });
  it('uses last actual save time of the round rather than round number', () => {
    const nodes = Array.from({ length: 11 }, (_, i) => node(i + 1, i + 1));
    expect(ids([...nodes, node(12, 1, 100)])).toEqual([2]);
  });
  it('rotates two roots independently and breaks equal timestamps by ID', () => {
    expect(ids(['a', 'b'].flatMap((root, r) => Array.from({ length: 11 }, (_, i) => node(r * 20 + i + 1, i, 100, root))))).toEqual([1, 21]);
  });
  it('does not prune unknown rounds, invalid rounds, unproven legacy summaries or unknown roots', () => {
    const trusted = Array.from({ length: 11 }, (_, i) => node(i + 1, i));
    const unknown = [node(100, NaN), node(101, -1), { ...node(102, 0), turnCountSource: undefined }, { ...node(103, 0), turnCountSource: 'inferred' }, { ...node(104, 0), saveTree: undefined }];
    expect(selectSaveNodeRotationCandidates([...trusted, ...unknown]).map(item => item.id)).toEqual([1]);
  });
  it('does not let a real root ID collide with the isolated legacy namespace', () => {
    const nodes = Array.from({ length: 11 }, (_, i) => node(i + 1, i, i + 1, 'legacy-isolated-auto-999'));
    expect(selectSaveNodeRotationCandidates([...nodes, { ...node(999, 999), saveTree: undefined }]).map(item => item.id)).toEqual([1]);
  });
  it('keeps manual node limit and imported/backup exemptions', () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({ ...node(i + 1, 0), type: 'manual' }));
    expect(selectSaveNodeRotationCandidates([...nodes, { ...node(20, 0), type: 'imported' }, { ...node(21, 0), type: 'backup' }]).map(item => item.id)).toEqual([1]);
  });
  it('normalization does not turn invalid or unmarked old turns into trustworthy zero', () => {
    const summary = { ...node(1, NaN), universe: 'teyvat', schemaVersion: 2 };
    expect(normalizeSaveCatalogRecord(summary)).toMatchObject({ turnCountSource: 'unknown' });
    expect(normalizeSaveCatalogRecord({ ...summary, turnCount: 7, turnCountSource: undefined })).toMatchObject({ turnCountSource: 'unknown' });
    expect(normalizeSaveCatalogRecord({ ...summary, turnCount: 7 })).toMatchObject({ turnCount: 7, turnCountSource: 'explicit' });
  });
});
