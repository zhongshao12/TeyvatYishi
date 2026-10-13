import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { createMoment, deleteMoment, editMoment } from '@/services/courierMoments';
import { commitMomentDraftImage } from '@/services/courierMomentImages';
import { 创建相册图片条目 } from '@/utils/albumActions';
import { buildSavePackage, readSavePackageEntries } from '@/services/savePackage';
import { normalizeJourneyAlbum } from '@/models/teyvat/runtimeSlices';

afterEach(() => vi.unstubAllGlobals());

it('exports referenced image bytes once and restores image-only Moments after shared-post deletion', async () => {
  class NodeFileReader {
    result = '';
    onload: (() => void) | null = null;
    async readAsDataURL(blob: Blob) {
      this.result = `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
      this.onload?.();
    }
  }
  vi.stubGlobal('FileReader', NodeFileReader);
  const image = 创建相册图片条目({ title: '湖边', src: 'data:image/png;base64,aGVsbG8=', source: 'upload', targetType: 'phone', slot: 'misc' });
  const committed = commitMomentDraftImage(createEmptyTeyvatGameState(), image);
  let game = committed.game;
  const images = [committed.reference!];
  game = { ...game, 手机: createMoment(game.手机, { id: 'p1', content: '', images, turn: 1, now: 1 }) };
  game = { ...game, 手机: createMoment(game.手机, { id: 'p2', content: '', images, turn: 1, now: 2 }) };
  game = { ...game, 手机: deleteMoment(game.手机, 'p1') };
  const files = await readSavePackageEntries(await (await buildSavePackage(game)).arrayBuffer());
  const serialized = files.get('save.json')!;
  const exported = JSON.parse(serialized);
  expect(JSON.stringify(exported.手机)).not.toContain('data:image');
  expect(serialized.match(/data:image\/png;base64,aGVsbG8=/g)).toHaveLength(1);
  const restored = normalizeTeyvatGameState(exported);
  expect(restored.手机.moments?.[0]).toMatchObject({ id: 'p2', content: '', images });
  expect(restored.相册.assets).toHaveLength(1);
  expect(restored.相册.entries[0]?.assetId).toBe(images[0]?.assetId);
});

it('reuses uploads by content hash without mutating shared entry metadata or publishing a Moment', () => {
  const game = createEmptyTeyvatGameState();
  const image = 创建相册图片条目({ title: '故事照片', src: 'https://example.invalid/lake.webp', source: 'upload', contentHash: 'a'.repeat(64), targetType: 'phone' });
  game.相册 = normalizeJourneyAlbum({ assets: [image.asset], entries: [{ ...image.entry, kind: 'snapshot', url: 'legacy', description: '旧说明', turn: 8 }] });
  const duplicate = 创建相册图片条目({ title: '朋友圈新上传', src: 'https://example.invalid/duplicate.webp', source: 'upload', contentHash: 'a'.repeat(64), targetType: 'phone' });
  const committed = commitMomentDraftImage(game, duplicate, { caption: '公开说明' });
  expect(committed.reference).toMatchObject({ entryId: image.entry.id, assetId: image.asset.id, caption: '公开说明' });
  expect(committed.game.相册.assets).toHaveLength(1);
  expect(committed.game.相册.entries[0]).toMatchObject({ kind: 'snapshot', url: 'legacy', description: '旧说明', turn: 8 });
  expect(committed.game.手机).toBe(game.手机);
});

it('refuses album-only completion after an edited post is removed or revised', () => {
  const initial = createEmptyTeyvatGameState();
  initial.手机 = createMoment(initial.手机, { id: 'p1', content: '旧稿', turn: 1, now: 1 });
  const image = 创建相册图片条目({ title: '图', src: 'https://example.invalid/lake.webp', source: 'generated', targetType: 'phone' });
  for (const phone of [deleteMoment(initial.手机, 'p1'), editMoment(initial.手机, 'p1', '新稿', 2)]) {
    const game = { ...initial, 手机: phone };
    expect(commitMomentDraftImage(game, image, { editing: { id: 'p1', revision: 1 } })).toEqual({ game });
  }
});

it('never exposes a private asset through upload de-duplication', () => {
  const game = createEmptyTeyvatGameState();
  const privateImage = 创建相册图片条目({ title: '私密', src: 'https://example.invalid/private.webp', source: 'upload', contentHash: 'b'.repeat(64), nsfw: true, targetType: 'phone' });
  game.相册 = normalizeJourneyAlbum({ assets: [privateImage.asset], entries: [privateImage.entry] });
  const upload = 创建相册图片条目({ title: '上传', src: 'https://example.invalid/duplicate.webp', source: 'upload', contentHash: 'b'.repeat(64), nsfw: false, targetType: 'phone' });
  expect(commitMomentDraftImage(game, upload)).toEqual({ game });
});
