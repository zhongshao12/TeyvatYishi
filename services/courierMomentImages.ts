import { 归一化相册系统, type 相册系统, type 相册条目, type 图片资源 } from '@/models/imageGeneration';
import type { CourierMomentImage } from '@/models/teyvat/courier';
import type { TeyvatGameState } from '@/models/teyvat/state';
import { normalizeJourneyAlbum } from '@/models/teyvat/runtimeSlices';
import { addOrReuseAlbumImage } from '@/components/features/GameSystems/album/albumContent';
import { 解析相册资源引用 } from '@/utils/albumActions';

export function resolveMomentImage(album: 相册系统 | undefined, image: CourierMomentImage): string | undefined {
  const entry = album?.entries.find(item => item.id === image.entryId && item.assetId === image.assetId && !item.nsfw);
  const asset = entry && album?.assets.find(item => item.id === image.assetId && !item.nsfw && item.status === 'ready');
  return asset ? 解析相册资源引用(album, `asset:${asset.id}`) : undefined;
}

/** The root transaction owns album data; the caller adds the returned reference only to its draft. */
export function commitMomentDraftImage(game: TeyvatGameState, image: { asset: 图片资源; entry: 相册条目 }, options: {
  taskId?: string; caption?: string; editing?: { id: string; revision: number };
} = {}): { game: TeyvatGameState; reference?: CourierMomentImage } {
  if (image.asset.nsfw || image.entry.nsfw || image.asset.status !== 'ready' || image.entry.assetId !== image.asset.id
    || (options.editing && !game.手机.moments?.some(post => post.id === options.editing?.id && post.revision === options.editing.revision))) return { game };
  const base = 归一化相册系统({ assets: game.相册.assets, tasks: game.相册.generationTasks,
    entries: game.相册.entries.flatMap<相册条目>(entry => entry.assetId ? [{
      ...entry, assetId: entry.assetId, title: entry.title ?? entry.description,
      targetType: entry.targetType ?? (entry.kind === 'character' ? 'misc' : 'scene'),
      slot: entry.slot ?? 'misc', tags: entry.tags ?? [], nsfw: entry.nsfw === true, referenceTargets: entry.referenceTargets ?? [],
    }] : []),
  });
  const merged = addOrReuseAlbumImage(base, image, image.asset.contentHash ?? '', image.asset.url);
  // Never relabel or expose an existing private asset found by content de-duplication.
  const asset = merged.album.assets.find(item => item.id === merged.entry.assetId);
  if (!asset || asset.nsfw || merged.entry.nsfw) return { game };
  const album = normalizeJourneyAlbum({ ...game.相册,
    assets: [...merged.album.assets.filter(item => !game.相册.assets.some(old => old.id === item.id)), ...game.相册.assets],
    entries: [...merged.album.entries.filter(item => !game.相册.entries.some(old => old.id === item.id)), ...game.相册.entries],
    generationTasks: game.相册.generationTasks.map(task => task.id === options.taskId ? {
      ...task, status: 'success', resultAssetId: asset.id, error: undefined, finishedAt: Date.now(),
    } : task) });
  const caption = options.caption?.trim().slice(0, 200);
  return { game: { ...game, 相册: album }, reference: { entryId: merged.entry.id, assetId: asset.id, ...(caption ? { caption } : {}) } };
}
