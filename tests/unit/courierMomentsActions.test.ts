import { expect, it } from 'vitest';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { 创建NPC记录 } from '@/models/npc';
import {
  appendMomentComment,
  countEligibleMomentCommenters,
  createMoment,
  deleteMoment,
  editMoment,
  markMomentTarget,
  restoreMoment,
  selectMomentCommenters,
} from '@/services/courierMoments';

it('creates, revises, and deletes player text without retaining stale comments', () => {
  const created = createMoment(createEmptyCourierSystem(), { id: 'p1', content: '  今天到蒙德了  ', turn: 3, now: 100 });
  expect(created.moments?.[0]?.content).toBe('今天到蒙德了');
  const commented = appendMomentComment(created, 'p1', 1, { id: 'c1', npcId: 'amber', npcName: '安柏', content: '欢迎！', createdAt: 101 });
  const edited = editMoment(commented, 'p1', '见到了安柏', 102);
  expect(edited.moments?.[0]).toMatchObject({ content: '见到了安柏', revision: 2, comments: [], targets: [] });
  expect(deleteMoment(edited, 'p1').moments).toEqual([]);
});

it('rejects empty, overlong, and over-cap posts without silently discarding old posts', () => {
  const empty = createEmptyCourierSystem();
  expect(() => createMoment(empty, { id: 'p1', content: ' ', turn: 1, now: 1 })).toThrow('MOMENT_EMPTY');
  expect(() => createMoment(empty, { id: 'p1', content: '风'.repeat(501), turn: 1, now: 1 })).toThrow('MOMENT_TOO_LONG');
  const full = { ...empty, moments: Array.from({ length: 500 }, (_, index) => ({
    id: `p${index}`, authorId: 'player' as const, content: '日记', turn: 1,
    createdAt: 1, updatedAt: 1, revision: 1, targets: [], comments: [],
  })) };
  expect(() => createMoment(full, { id: 'extra', content: '新日记', turn: 1, now: 2 })).toThrow('MOMENT_LIMIT');
  expect(full.moments).toHaveLength(500);
});

it('selects only unique known contacts whose affinity is strictly above 100', () => {
  const contacts = [
    { id: 'c1', npcId: 'amber', name: '安柏', available: true },
    { id: 'c2', npcId: 'amber', name: '安柏', available: true },
    { id: 'c3', npcId: 'lisa', name: '丽莎', available: true },
    { id: 'c4', name: '路人', available: true },
  ];
  const npcs = [
    { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber', 好感度: 101 },
    { ...创建NPC记录({ 姓名: '丽莎', 初见回合: 1 }), id: 'lisa', 好感度: 100 },
  ];
  expect(selectMomentCommenters('p1', contacts, npcs).map((npc) => npc.id)).toEqual(['amber']);
  expect(countEligibleMomentCommenters(contacts, npcs)).toBe(1);
  expect(countEligibleMomentCommenters([...contacts, { id: 'c5', npcId: 'lisa', name: '丽莎', available: false }], npcs)).toBe(1);
  expect(countEligibleMomentCommenters(contacts, [{ ...npcs[0]!, 好感度: 100 }, { ...npcs[1]!, 好感度: 101 }])).toBe(1);
});

it('counts all eligible commenters even though a post selects at most three', () => {
  const npcs = ['amber', 'lisa', 'jean', 'noelle'].map((id) => ({
    ...创建NPC记录({ 姓名: id, 初见回合: 1 }), id, 好感度: 101,
  }));
  const contacts = npcs.map((npc) => ({ id: `contact-${npc.id}`, npcId: npc.id, name: npc.姓名, available: true }));
  expect(countEligibleMomentCommenters(contacts, npcs)).toBe(4);
  expect(selectMomentCommenters('p1', contacts, npcs)).toHaveLength(3);
});

it('does not write duplicate or stale-revision comments', () => {
  const created = createMoment(createEmptyCourierSystem(), { id: 'p1', content: '今天很好', turn: 1, now: 1 });
  const pending = markMomentTarget(created, 'p1', 1, 'amber', 'generating');
  const comment = { id: 'c1', npcId: 'amber', npcName: '安柏', content: '下次一起呀', createdAt: 2 };
  const once = appendMomentComment(pending, 'p1', 1, comment);
  expect(appendMomentComment(once, 'p1', 1, comment).moments?.[0]?.comments).toHaveLength(1);
  expect(appendMomentComment(once, 'p1', 0, { ...comment, id: 'late', npcId: 'lisa' }).moments?.[0]?.comments).toHaveLength(1);
});

it('undoes deletion with a new revision so an old pending comment cannot return', () => {
  const created = createMoment(createEmptyCourierSystem(), { id: 'p1', content: '路上见', turn: 1, now: 1 });
  const generating = markMomentTarget(created, 'p1', 1, 'amber', 'generating');
  const removed = deleteMoment(generating, 'p1');
  const restored = restoreMoment(removed, generating.moments![0]!);
  expect(restored.moments?.[0]).toMatchObject({ revision: 2, targets: [{ npcId: 'amber', status: 'failed' }] });
  expect(appendMomentComment(restored, 'p1', 1, { id: 'old', npcId: 'amber', npcName: '安柏', content: '旧评论', createdAt: 2 }).moments?.[0]?.comments).toEqual([]);
});
