import { describe, expect, it } from 'vitest';
import { normalizeArchiveCodex } from '@/models/teyvat/codex';
import { buildCodexArchiveItems } from '@/components/features/Codex/productionAdapter';
import { retrieveCodexEntries } from '@/services/codexRetrieval';
import { buildCodexAiCandidateIndex, compileCodexAiSelection } from '@/services/codexAiRetrievalIndex';

const codex = normalizeArchiveCodex({ entries: ['character', 'location', 'term', 'lore'].map(category => ({
  id: category, name: `测试${category}`, category, summary: `明灯${category}的完整说明`,
  keywords: ['明灯'], injection: { publicText: `明灯${category}的公开档案` }, runtimeUnlock: { status: 'locked' },
})) });

describe('player codex open access', () => {
  it('also exposes locked entries to the supplemental AI retrieval index', () => {
    const index = buildCodexAiCandidateIndex(codex, codex.entries);
    expect(index.candidates.map(entry => entry.name)).toContain('测试location');
    expect(index.candidates.map(entry => entry.name)).toContain('测试term');
    expect(index.candidates.map(entry => entry.name)).toContain('测试lore');
    expect(compileCodexAiSelection(index, { selectedIds: ['location'] }).injection).toContain('不是 NPC 已知信息');
  });
  it('exposes and searches every category without changing story discovery flags', () => {
    const before = JSON.stringify(codex);
    const items = buildCodexArchiveItems(codex);
    expect(items.every(item => item.readable && item.summary && item.searchText.includes('完整说明'))).toBe(true);
    expect(items.every(item => !item.unlocked)).toBe(true);
    expect(JSON.stringify(codex)).toBe(before);
  });
  it.each(['character', 'location', 'term', 'lore'])('recalls relevant locked %s for the author, not as NPC knowledge', category => {
    const result = retrieveCodexEntries(codex, `测试${category}`, 1);
    expect(result.entries.map(entry => entry.id)).toEqual([category]);
    expect(result.injection).toContain(`明灯${category}的公开档案`);
    expect(result.injection).toContain('不是 NPC 已知信息');
    expect(codex.unlockedEntryIds).toEqual([]);
  });
  it('retains relevance and configured entry limits rather than injecting the entire library', () => {
    expect(retrieveCodexEntries(codex, '完全无关XYZ').entries).toEqual([]);
    expect(retrieveCodexEntries(codex, '明灯', 2).entries).toHaveLength(2);
    expect(retrieveCodexEntries(codex, '', 2).injection).toBe('');
  });
});
