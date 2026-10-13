import { expect, it } from 'vitest';
import { createEmptyCourierSystem, normalizeCourierSystem } from '@/models/teyvat/courier';
import { createMoment, editMoment, deleteMoment } from '@/services/courierMoments';
import { buildMomentCommentPrompt } from '@/services/ai/courierMomentComments';
import { 创建NPC记录 } from '@/models/npc';

const images = [{ entryId: 'entry-1', assetId: 'asset-1', caption: '玩家写的湖边说明' }];

it('allows image-only Moments with reference-only attachments', () => {
  const created = createMoment(createEmptyCourierSystem(), { id: 'p1', content: '', images, turn: 1, now: 1 });
  expect(created.moments?.[0]).toMatchObject({ content: '', images });
  expect(normalizeCourierSystem(JSON.parse(JSON.stringify(created))).moments?.[0]).toMatchObject({ content: '', images });
});

it('normalizes bounded unique image references without persisting image payloads', () => {
  const raw = { id: 'p1', authorId: 'player', content: '', turn: 1, createdAt: 1, revision: 1,
    images: [...images, { ...images[0], src: 'data:image/png;base64,SECRET' },
      ...Array.from({ length: 12 }, (_, i) => ({ entryId: `e${i}`, assetId: `a${i}`, caption: '图' })),
      { entryId: '', assetId: 'invalid' }], comments: [], targets: [] };
  const post = normalizeCourierSystem({ moments: [raw] }).moments?.[0];
  expect(post?.images).toHaveLength(9);
  expect(post?.images?.[0]).toEqual(images[0]);
  expect(JSON.stringify(post)).not.toContain('SECRET');
});

it('edits and removes attachments while keeping revision safety and existing album ownership', () => {
  const created = createMoment(createEmptyCourierSystem(), { id: 'p1', content: '湖边', images, turn: 1, now: 1 });
  const revised = editMoment(created, 'p1', '', 2, ['amber'], images);
  expect(revised.moments?.[0]).toMatchObject({ content: '', images, revision: 2, targets: [], comments: [], mentionIds: ['amber'] });
  expect(() => editMoment(revised, 'p1', '', 3, [], [])).toThrow('MOMENT_EMPTY');
  expect(deleteMoment(revised, 'p1').moments).toEqual([]);
});

it('rejects too many attachments instead of silently cutting a new post', () => {
  expect(() => createMoment(createEmptyCourierSystem(), { id: 'p1', content: '图', turn: 1, now: 1,
    images: Array.from({ length: 10 }, (_, i) => ({ entryId: `e${i}`, assetId: `a${i}` })) })).toThrow('MOMENT_IMAGE_LIMIT');
});

it('drops image payloads disguised as reference IDs', () => {
  const post = { id: 'p1', authorId: 'player', content: '', turn: 1, createdAt: 1, revision: 1,
    images: [{ entryId: 'valid-entry', assetId: 'data:image/png;base64,SECRET' }], targets: [], comments: [] };
  expect(normalizeCourierSystem({ moments: [post] }).moments).toEqual([]);
});

it('exposes only public image captions to the text-only comment model', () => {
  const post = createMoment(createEmptyCourierSystem(), { id: 'p1', content: '', images, turn: 1, now: 1 }).moments![0]!;
  const prompt = buildMomentCommentPrompt({ post, npc: 创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), profile: {
    name: '安柏', recentMemories: ['私密档案内容'],
  } });
  expect(prompt).toContain('玩家写的湖边说明');
  expect(prompt).toContain('无法查看图片');
  expect(prompt).not.toContain('asset-1');
  expect(prompt).not.toContain('私密档案内容');
});
