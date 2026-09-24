import { expect, it } from 'vitest';
import { createEmptyCourierSystem, normalizeCourierSystem } from '@/models/teyvat/courier';

it('adds an empty moments slice to new and old saves', () => {
  expect(createEmptyCourierSystem().moments).toEqual([]);
  expect(normalizeCourierSystem({ contacts: [] }).moments).toEqual([]);
});

it('turns interrupted comment generation into a retryable state on load', () => {
  const raw = {
    moments: [{
      id: 'p1', authorId: 'player', content: '今天真好', turn: 2,
      createdAt: 1, updatedAt: 1, revision: 1,
      targets: [{ npcId: 'amber', status: 'generating' }, { npcId: 'amber', status: 'done' }],
      comments: [],
    }],
  };
  const restored = normalizeCourierSystem(JSON.parse(JSON.stringify(raw)));
  expect(restored.moments?.[0]?.targets).toEqual([{ npcId: 'amber', status: 'failed' }]);
  expect(restored.moments?.[0]?.content).toBe('今天真好');
});

it('keeps a valid completed comment through save normalization', () => {
  const raw = {
    moments: [{
      id: 'p2', authorId: 'player', content: '蒙德的风很好', turn: 2,
      createdAt: 1, updatedAt: 1, revision: 1,
      targets: [{ npcId: 'amber', status: 'done' }],
      comments: [{ id: 'c1', npcId: 'amber', npcName: '安柏', content: '下次一起去高处看看！', createdAt: 2 }],
    }],
  };
  expect(normalizeCourierSystem(JSON.parse(JSON.stringify(raw))).moments?.[0]?.comments[0]?.content)
    .toBe('下次一起去高处看看！');
});
