import type { SaveListItemSummary } from '@/services/storage/saveCatalog';

export function getSaveJourneyIdentity(save: SaveListItemSummary): string {
  const rootId = save.saveTree?.rootId;
  return JSON.stringify(rootId?.trim() ? ['root', rootId] : ['legacy', save.id]);
}

export function getSaveJourneyLabel(save: SaveListItemSummary): string {
  const name = save.journeyDisplayName || save.travelerName.trim() || '未命名旅人';
  return save.journeyOrdinal ? `${name}${String(save.journeyOrdinal).padStart(2, '0')}` : name;
}
