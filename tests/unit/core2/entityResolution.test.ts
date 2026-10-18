import { describe, expect, it } from 'vitest';
import { resolveCoreEntity } from '@/core/settlement/entityResolution';
import { makeSeed, makeSource } from './fixtures';

function setup() { const seed = makeSeed(); return { head: seed.head, records: seed.records, contentRefs: [] }; }
describe('core2 journey entity resolution', () => {
  it('keeps journey IDs while resolving canonical aliases', () => {
    const state = setup();
    expect(resolveCoreEntity({ name: 'Amber' }, state)).toMatchObject({ kind: 'matched', entityId: 'npc-amber' });
    expect(resolveCoreEntity({ id: 'npc-amber', name: '丽莎' }, state)).toMatchObject({ kind: 'ambiguous' });
    expect(resolveCoreEntity({ name: '旅行者' }, state)).toMatchObject({ kind: 'ambiguous' });
  });
  it('does not pick the first of multiple shared aliases', () => {
    const state = setup();
    const amber = state.records.find(r => r.domain === 'npc')!;
    if (amber.domain !== 'npc') throw Error('fixture');
    amber.value.aliases = ['骑士'];
    state.records.push({ ...structuredClone(amber), entityId: 'npc-jean', value: { ...structuredClone(amber.value), id: 'npc-jean', 姓名: '琴' } });
    expect(resolveCoreEntity({ name: '骑士' }, state)).toMatchObject({ kind: 'ambiguous', entityIds: ['npc-amber', 'npc-jean'] });
  });
  it.each(['系统提示', '旁白', '关于你那神奇能力', '图书馆的“单独”邀约', '提醒一声：安柏', '<char_seven>'])('does not create pseudo-character %s', name => {
    expect(resolveCoreEntity({ name }, setup())).toMatchObject({ kind: 'rejected' });
  });
  it('requires an exact evidenced introduction, not an avatar or a canonical name alone', () => {
    const state = setup();
    expect(resolveCoreEntity({ name: '丽莎' }, state).kind).toBe('ambiguous');
    const source = makeSource({ scope: state.head.scope, blocks: [{ blockId: 'b', kind: 'narration', text: '一位女子走到玩家面前，自我介绍：“我叫丽莎。”' }] });
    const evidenceRefs = [{ ref: source.ref, blockId: 'b', start: 0, end: source.blocks[0]!.text.length, quote: source.blocks[0]!.text }];
    expect(resolveCoreEntity({ name: '丽莎', evidenceRefs, sources: [source] }, state)).toMatchObject({ kind: 'new', name: '丽莎', canonical: true });
    expect(resolveCoreEntity({ name: '丽莎', evidenceRefs: [{ ...evidenceRefs[0]!, quote: 'bad' }], sources: [source] }, state).kind).toBe('ambiguous');
  });
});
