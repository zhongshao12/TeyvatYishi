import { describe, expect, it } from 'vitest';
import { freezeSource, validateEvidence, type SourceInput } from '@/core/sources/sourceRecords';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { fixtureMoment } from './fixtures';

const input = (): SourceInput => ({ scope: { journeyId: 'journey-1', branchId: 'branch-1' }, operationId: 'operation-fixture', kind: 'narrative', blocks: [{ blockId: 'body-1', kind: 'narration', text: '🙂安柏递来苹果' }], moment: structuredClone(fixtureMoment), createdAt: 0 });

describe('core2 immutable sources', () => {
  it('preserves visible blocks in order and discards hidden protocol blocks', () => {
    const source = freezeSource({ ...input(), blocks: [
      { blockId: 'hidden-1', kind: 'analysis', text: 'internal reasoning' },
      { blockId: 'body-1', kind: 'narration', text: '安柏递来苹果' },
      { blockId: 'vars', kind: 'variables', text: 'NPC.affinity=150' },
      { blockId: 'reply-1', kind: 'dialogue', text: '路上小心。', speakerId: 'npc-amber' },
      { blockId: 'wire', kind: 'protocol', text: 'Complete.' },
    ] });
    expect(source.blocks.map(block => block.text)).toEqual(['安柏递来苹果', '路上小心。']);
    expect(source.blocks.map(block => block.blockId)).toEqual(['body-1', 'reply-1']);
  });

  it('owns immutable copies of the text, scope and game moment', () => {
    const draft = input();
    const source = freezeSource(draft);
    draft.blocks[0]!.text = '显示正则后来替换了文字';
    draft.scope.journeyId = 'other';
    draft.moment.clock = '23:00';
    expect(source.blocks[0]!.text).toBe('🙂安柏递来苹果');
    expect(source.scope.journeyId).toBe('journey-1');
    expect(source.moment.clock).toBe('10:00');
    expect(() => { source.blocks[0]!.text = 'overwrite'; }).toThrow();
  });

  it('creates a new immutable version instead of changing the old material', () => {
    const original = freezeSource(input());
    const edited = freezeSource({ ...input(), operationId: 'operation-edit', previous: original, blocks: [{ blockId: 'body-1', kind: 'narration', text: '安柏递来两个苹果' }] });
    expect(edited.ref.sourceId).toBe(original.ref.sourceId);
    expect(edited.ref.sourceVersion).toBe(2);
    expect(original.ref.sourceVersion).toBe(1);
    expect(original.blocks[0]!.text).toBe('🙂安柏递来苹果');
  });

  it('does not use repeated text, a name or its checksum as a new source identity', () => {
    const a = freezeSource(input());
    const b = freezeSource(input());
    expect(a.ref.sourceId).not.toBe(b.ref.sourceId);
    expect(a.ref.sourceVersion).toBe(1);
    expect(b.ref.sourceVersion).toBe(1);
  });

  it('refuses an empty, hidden-only or duplicate-block source', () => {
    expect(() => freezeSource({ ...input(), blocks: [] })).toThrow();
    expect(() => freezeSource({ ...input(), blocks: [{ blockId: 'h', kind: 'analysis', text: 'hidden' }] })).toThrow();
    expect(() => freezeSource({ ...input(), blocks: [{ blockId: 'b', kind: 'narration', text: '' }] })).toThrow();
    expect(() => freezeSource({ ...input(), blocks: [{ blockId: 'b', kind: 'narration', text: '甲' }, { blockId: 'b', kind: 'dialogue', text: '乙' }] })).toThrow();
  });

  it('refuses a version edit across journeys or source categories', () => {
    const previous = freezeSource(input());
    expect(() => freezeSource({ ...input(), scope: { journeyId: 'journey-2', branchId: 'branch-1' }, previous })).toThrow();
    expect(() => freezeSource({ ...input(), kind: 'courier', previous })).toThrow();
  });

  it('never fills missing game-world dates from the computer clock', () => {
    const source = freezeSource({ ...input(), moment: { ...fixtureMoment, date: null, clock: null }, createdAt: 99_999 });
    expect(source.moment.date).toBeNull();
    expect(source.moment.clock).toBeNull();
    expect(source.createdAt).toBe(99_999);
    expect(() => freezeSource({ ...input(), moment: undefined } as unknown as SourceInput)).toThrow();
  });
});

describe('core2 evidence spans', () => {
  it('uses exact UTF-16 offsets without confusing an emoji with one code unit', () => {
    const source = freezeSource(input());
    expect(validateEvidence({ ref: source.ref, blockId: 'body-1', start: 2, end: 8, quote: '安柏递来苹果' }, source)).toEqual({ ok: true });
    expect(validateEvidence({ ref: source.ref, blockId: 'body-1', start: 1, end: 7, quote: '安柏递来苹果' }, source).ok).toBe(false);
  });

  it('rejects the right quote from the wrong source or version', () => {
    const source = freezeSource(input());
    const ref = { ref: source.ref, blockId: 'body-1', start: 2, end: 8, quote: '安柏递来苹果' };
    expect(validateEvidence({ ...ref, ref: { ...source.ref, sourceId: 'other-source' } }, source)).toMatchObject({ ok: false, code: 'source_mismatch' });
    expect(validateEvidence({ ...ref, ref: { ...source.ref, sourceVersion: 2 } }, source)).toMatchObject({ ok: false, code: 'version_mismatch' });
  });

  it('rejects out-of-bounds, missing blocks and wrong quotes', () => {
    const source = freezeSource(input());
    expect(validateEvidence({ ref: source.ref, blockId: 'body-1', start: 2, end: 99, quote: '安柏递来苹果' }, source).ok).toBe(false);
    expect(validateEvidence({ ref: source.ref, blockId: 'missing', start: 2, end: 8, quote: '安柏递来苹果' }, source).ok).toBe(false);
    expect(validateEvidence({ ref: source.ref, blockId: 'body-1', start: 2, end: 8, quote: '玩家送出苹果' }, source).ok).toBe(false);
  });
});

describe('portable UTF-8 checksums', () => {
  it('uses the FNV-1a 64-bit byte vectors, not UTF-16 character values', () => {
    expect(checksumUtf8('')).toBe('cbf29ce484222325');
    expect(checksumUtf8('hello')).toBe('a430d84680aabd0b');
    expect(checksumUtf8('a')).toBe('af63dc4c8601ec8c');
  });
});
